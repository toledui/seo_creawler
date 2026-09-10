import { getAppSettings } from '../../lib/settings';

/**
 * Cliente de la API nativa /v1 de Serplify.
 *
 * La clave es única para toda la instancia y la configura el administrador:
 * el saldo de Serplify es prepago y compartido, así que una clave por
 * cuenta sólo repartiría el mismo monedero.
 *
 * Sólo se usa la SERP API. La Traffic API (visitas y clics sintéticos)
 * queda deliberadamente fuera: entrega tráfico artificial para mover
 * señales de CTR, que es manipulación de resultados de búsqueda.
 */

export class SerplifyNotConfiguredError extends Error {
  constructor() {
    super(
      'Serplify no está configurado. El administrador debe añadir la clave de API.',
    );
  }
}

export class SerplifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }

  /** Saldo agotado: merece un mensaje propio en la interfaz. */
  get isOutOfBalance() {
    return this.status === 402 || this.code === 'insufficient_balance';
  }

  get isRateLimited() {
    return this.status === 429;
  }
}

/** Precio por SERP según la documentación; sirve para estimar el gasto. */
export const SERP_COST_USD = 0.005;

/**
 * Topes de tiempo por llamada.
 *
 * Sin ellos una respuesta lenta dejaría colgado al worker durante el
 * tracking diario, que es exactamente donde nadie está mirando.
 */
const TIMEOUT_MS = {
  /** Un SERP en vivo tarda ~1 s, pero damos margen. */
  search: Number(process.env.SERPLIFY_SEARCH_TIMEOUT_MS ?? 45_000),
  /** Referencias e histórico: son consultas ligeras. */
  reference: Number(process.env.SERPLIFY_TIMEOUT_MS ?? 20_000),
} as const;

export type SerplifyConfig = {
  apiKey: string;
  baseUrl: string;
};

export async function serplifyConfig(): Promise<SerplifyConfig | null> {
  const { serplify } = await getAppSettings();
  if (!serplify.configured || !serplify.enabled) return null;
  return { apiKey: serplify.apiKey!, baseUrl: serplify.baseUrl };
}

type Envelope<T> = {
  request_id: string;
  status: string;
  meta?: { api_version?: string; time?: number; cost?: number; currency?: string };
  data: T;
};

async function call<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    config?: SerplifyConfig;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<Envelope<T>> {
  const config = options.config ?? (await serplifyConfig());
  if (!config) throw new SerplifyNotConfiguredError();

  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS.reference;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Respetamos también el signal que venga de fuera (cancelar el request).
  const external = options.signal;
  const onAbort = () => controller.abort();
  external?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError' && !external?.aborted) {
      throw new SerplifyError(
        `Serplify no respondió en ${Math.round(timeoutMs / 1000)} s`,
        504,
        'timeout',
      );
    }
    throw new SerplifyError(
      `No se pudo contactar con Serplify: ${(err as Error).message}`,
      503,
      'network_error',
    );
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }

  const text = await res.text();

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new SerplifyError(
      `Respuesta no JSON (${res.status}): ${text.slice(0, 200)}`,
      res.status,
      'bad_response',
    );
  }

  if (!res.ok) {
    // El contrato /v1 devuelve { error: { code, message } }.
    const error = (parsed as { error?: { code?: string; message?: string } }).error;
    throw new SerplifyError(
      error?.message ?? `Serplify devolvió ${res.status}`,
      res.status,
      error?.code ?? 'unknown',
    );
  }

  return parsed as Envelope<T>;
}

// --------------------------------------------------------------- Tipos

export type SerpItem = {
  type: string;
  rank_group?: number;
  rank_absolute?: number;
  domain?: string;
  title?: string;
  description?: string;
  url?: string;
  breadcrumb?: string;
  cid?: string;
  rating?: unknown;
  items?: { title?: string; url?: string }[];
};

export type SerpSearchData = {
  keyword: string;
  search_engine: string;
  search_engine_domain: string;
  device: string;
  location: { code: number; name: string };
  language: { code: string; name: string };
  result_url: string;
  fetched_at: string;
  total_results_count: number;
  items_count: number;
  feature_types: string[];
  items: SerpItem[];
  tracked_rank?: {
    target: string;
    rank_absolute: number | null;
    rank_group: number | null;
    url: string | null;
    found: boolean;
  };
};

export type SerpSearchOptions = {
  keyword: string;
  locationCode: number;
  languageCode: string;
  device?: 'desktop' | 'mobile';
  /** Dominio a seguir; activa el snapshot de ranking en Serplify. */
  target?: string;
  /** Etiqueta de agrupación (usamos el nombre del proyecto). */
  label?: string;
  config?: SerplifyConfig;
  signal?: AbortSignal;
};

export type SerpSearchResult = {
  data: SerpSearchData;
  cost: number;
  requestId: string;
};

/**
 * SERP en vivo. Tarda ~1 s y cuesta $0,005 si tiene éxito.
 *
 * Se pide `format: advanced` porque trae los bloques enriquecidos (PAA,
 * local pack, featured snippet) que alimentan el análisis GEO.
 */
export async function serpSearch(
  options: SerpSearchOptions,
): Promise<SerpSearchResult> {
  const body: Record<string, unknown> = {
    keyword: options.keyword,
    location: { code: options.locationCode },
    language: { code: options.languageCode },
    device: options.device ?? 'desktop',
    format: 'advanced',
  };

  if (options.target) {
    body.track = {
      target: options.target,
      ...(options.label ? { label: options.label.slice(0, 60) } : {}),
    };
  }

  const envelope = await call<SerpSearchData>('/v1/serp/search', {
    method: 'POST',
    body,
    config: options.config,
    signal: options.signal,
    timeoutMs: TIMEOUT_MS.search,
  });

  return {
    data: envelope.data,
    cost: envelope.meta?.cost ?? SERP_COST_USD,
    requestId: envelope.request_id,
  };
}

export type TrackSnapshot = {
  captured_at: string;
  rank_absolute: number | null;
  rank_group: number | null;
  url: string | null;
};

/** Histórico de posiciones que guarda Serplify. Consultarlo es gratis. */
export async function serpTrackHistory(options: {
  keyword: string;
  target: string;
  locationCode?: number;
  languageCode?: string;
  device?: string;
  limit?: number;
  config?: SerplifyConfig;
}): Promise<TrackSnapshot[]> {
  const params = new URLSearchParams({
    keyword: options.keyword,
    target: options.target,
  });

  if (options.locationCode) params.set('location_code', String(options.locationCode));
  if (options.languageCode) params.set('language_code', options.languageCode);
  if (options.device) params.set('device', options.device);
  params.set('limit', String(Math.min(options.limit ?? 100, 1000)));

  const envelope = await call<{ snapshots: TrackSnapshot[] }>(
    `/v1/serp/track?${params}`,
    { config: options.config },
  );

  return envelope.data.snapshots ?? [];
}

export type SerpLocation = { code: number; name: string; country_iso_code?: string };
export type SerpLanguage = { code: string; name: string };

/** Referencias de Google. Son gratuitas, así que se cachean en memoria. */
let locationCache: { value: SerpLocation[]; expires: number } | null = null;
let languageCache: { value: SerpLanguage[]; expires: number } | null = null;
const REFERENCE_TTL = 6 * 3600 * 1000;

export async function serpLocations(
  country?: string,
): Promise<SerpLocation[]> {
  if (!country && locationCache && locationCache.expires > Date.now()) {
    return locationCache.value;
  }

  const path = country
    ? `/v1/locations/${encodeURIComponent(country)}`
    : '/v1/locations';

  const envelope = await call<{ locations: SerpLocation[] }>(path);
  const locations = envelope.data.locations ?? [];

  if (!country) {
    locationCache = { value: locations, expires: Date.now() + REFERENCE_TTL };
  }

  return locations;
}

export async function serpLanguages(): Promise<SerpLanguage[]> {
  if (languageCache && languageCache.expires > Date.now()) {
    return languageCache.value;
  }

  const envelope = await call<{ languages: SerpLanguage[] }>('/v1/languages');
  const languages = envelope.data.languages ?? [];
  languageCache = { value: languages, expires: Date.now() + REFERENCE_TTL };
  return languages;
}

/**
 * Comprueba que la clave funciona.
 *
 * Usa `/v1/languages`, que es gratuito: probar la conexión no debe gastar
 * saldo.
 */
export async function verifySerplify(
  config?: SerplifyConfig,
): Promise<{ ok: boolean; error?: string; languages?: number }> {
  try {
    const envelope = await call<{ languages: SerpLanguage[] }>('/v1/languages', {
      config,
    });
    return { ok: true, languages: envelope.data.languages?.length ?? 0 };
  } catch (err) {
    if (err instanceof SerplifyNotConfiguredError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof SerplifyError) {
      return { ok: false, error: `${err.code}: ${err.message}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Dominio limpio para comparar con `domain` de los resultados. */
export function normalizeTarget(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
}
