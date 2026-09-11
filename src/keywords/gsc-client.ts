import { prisma } from '../../lib/prisma';
import { decrypt, encrypt } from '../../lib/crypto';
import { getAppSettings } from '../../lib/settings';

/**
 * Cliente mínimo de Google Search Console (Search Analytics API).
 *
 * Es la única fuente gratuita y conforme a los términos de Google para
 * saber por qué consultas rankea ya un sitio: scrapear el SERP está
 * prohibido y además se bloquea.
 *
 * La autorización es **por cuenta**: el usuario conecta su Google una vez
 * y cada proyecto elige después cuál de sus propiedades mide. Las
 * credenciales OAuth de la aplicación son globales y las configura el
 * administrador, porque identifican a la app, no al usuario.
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';

export const GSC_SCOPE =
  'https://www.googleapis.com/auth/webmasters.readonly email';

export class GscNotConfiguredError extends Error {
  constructor() {
    super(
      'Search Console no está configurado. El administrador debe registrar las credenciales OAuth de Google.',
    );
  }
}

export class GscError extends Error {}

export async function gscConfigured(): Promise<boolean> {
  return (await getAppSettings()).google.configured;
}

export async function oauthRedirectUri(): Promise<string> {
  const settings = await getAppSettings();
  return `${settings.appUrl}/api/auth/google/callback`;
}

/**
 * URL a la que enviamos al usuario para que autorice el acceso.
 *
 * `select_account` obliga a Google a preguntar qué cuenta usar: sin él,
 * "añadir otra cuenta" reutilizaría en silencio la sesión activa.
 * `loginHint` preselecciona una cuenta concreta al reconectarla.
 */
export async function buildAuthUrl(state: string, loginHint?: string | null): Promise<string> {
  const settings = await getAppSettings();
  if (!settings.google.configured) throw new GscNotConfiguredError();

  const params = new URLSearchParams({
    client_id: settings.google.clientId!,
    redirect_uri: await oauthRedirectUri(),
    response_type: 'code',
    scope: GSC_SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  const json = (await res.json()) as TokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!res.ok) {
    throw new GscError(
      `OAuth falló (${res.status}): ${json.error_description ?? json.error ?? 'error desconocido'}`,
    );
  }

  return json;
}

/** Intercambia el código de autorización por tokens. */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const settings = await getAppSettings();
  if (!settings.google.configured) throw new GscNotConfiguredError();

  return tokenRequest({
    code,
    client_id: settings.google.clientId!,
    client_secret: settings.google.clientSecret!,
    redirect_uri: await oauthRedirectUri(),
    grant_type: 'authorization_code',
  });
}

/** Email de la cuenta de Google, sacado del id_token sin verificar firma. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1];
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { email?: string };
    return decoded.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Guarda (cifrados) los tokens de una cuenta de Google y devuelve su id.
 *
 * Se identifica por el email: reconectar la misma cuenta actualiza la
 * conexión existente y conectar otra distinta crea una nueva.
 */
export async function saveTokens(
  userId: string,
  tokens: TokenResponse,
): Promise<string> {
  const googleEmail = emailFromIdToken(tokens.id_token);
  const data = {
    accessToken: encrypt(tokens.access_token),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    googleEmail,
    lastError: null,
    ...(tokens.refresh_token
      ? { refreshToken: encrypt(tokens.refresh_token) }
      : {}),
  };

  const existing = await prisma.gscAccount.findFirst({
    where: { userId, googleEmail },
    select: { id: true },
  });

  if (existing) {
    await prisma.gscAccount.update({ where: { id: existing.id }, data });
    return existing.id;
  }

  const created = await prisma.gscAccount.create({ data: { userId, ...data } });
  return created.id;
}

/** Devuelve un access token válido para la cuenta, renovándolo si hace falta. */
export async function accessTokenFor(accountId: string): Promise<string> {
  const account = await prisma.gscAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new GscError('La cuenta de Google no está conectada a Search Console');

  const refreshToken = decrypt(account.refreshToken);
  if (!refreshToken) {
    throw new GscError('La conexión no tiene refresh token; vuelve a autorizar');
  }

  const current = decrypt(account.accessToken);
  const stillValid =
    current && account.expiresAt && account.expiresAt.getTime() > Date.now() + 60_000;

  if (stillValid) return current;

  const settings = await getAppSettings();
  if (!settings.google.configured) throw new GscNotConfiguredError();

  const refreshed = await tokenRequest({
    refresh_token: refreshToken,
    client_id: settings.google.clientId!,
    client_secret: settings.google.clientSecret!,
    grant_type: 'refresh_token',
  });

  await prisma.gscAccount.update({
    where: { id: accountId },
    data: {
      accessToken: encrypt(refreshed.access_token),
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      lastError: null,
    },
  });

  return refreshed.access_token;
}

export type GscSite = { siteUrl: string; permissionLevel: string };

/** Propiedades a las que tiene acceso una cuenta de Google conectada. */
export async function listSites(accountId: string): Promise<GscSite[]> {
  const token = await accessTokenFor(accountId);
  const res = await fetch(`${API_BASE}/sites`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    // Google explica el motivo en el cuerpo (API deshabilitada, falta de
    // permiso…); sin él un 403 es imposible de diagnosticar.
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const detail = body?.error?.message;
    throw new GscError(
      `No se pudieron listar las propiedades (${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  const json = (await res.json()) as { siteEntry?: GscSite[] };
  return json.siteEntry ?? [];
}

export type GscQueryRow = {
  query: string;
  page: string | null;
  country: string | null;
  device: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/**
 * Consulta Search Analytics agrupando por consulta.
 *
 * Una sola llamada trae hasta 25.000 filas, así que un proyecto entero
 * se resuelve con una petición al día en lugar de una por keyword: es la
 * diferencia entre saturar la cuota y no notarlo.
 */
export async function fetchSearchAnalytics(
  accountId: string,
  options: {
    siteUrl: string;
    startDate: string;
    endDate: string;
    rowLimit?: number;
    startRow?: number;
    dimensions?: ('query' | 'page' | 'country' | 'device' | 'date')[];
  },
): Promise<GscQueryRow[]> {
  const token = await accessTokenFor(accountId);
  const dimensions = options.dimensions ?? ['query', 'page'];

  const res = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(options.siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startDate: options.startDate,
        endDate: options.endDate,
        dimensions,
        rowLimit: options.rowLimit ?? 25_000,
        startRow: options.startRow ?? 0,
        dataState: 'final',
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GscError(
      `Search Analytics devolvió ${res.status}: ${text.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as {
    rows?: {
      keys: string[];
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }[];
  };

  return (json.rows ?? []).map((row) => {
    const keyed: Record<string, string> = {};
    dimensions.forEach((dimension, i) => {
      keyed[dimension] = row.keys[i] ?? '';
    });

    return {
      query: keyed.query ?? '',
      page: keyed.page ?? null,
      country: keyed.country ?? null,
      device: keyed.device ?? null,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    };
  });
}

export type GscAccountSummary = {
  id: string;
  googleEmail: string | null;
  lastError: string | null;
  connectedAt: Date;
};

/** Cuentas de Google conectadas (con refresh token utilizable), la más antigua primero. */
export async function listAccounts(userId: string): Promise<GscAccountSummary[]> {
  const rows = await prisma.gscAccount.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      googleEmail: true,
      lastError: true,
      updatedAt: true,
      refreshToken: true,
    },
  });

  return rows
    .filter((row) => Boolean(decrypt(row.refreshToken)))
    .map((row) => ({
      id: row.id,
      googleEmail: row.googleEmail,
      lastError: row.lastError,
      connectedAt: row.updatedAt,
    }));
}

/** Cada cuenta conectada con sus propiedades; el fallo de una no tumba las demás. */
export async function listAccountsWithSites(userId: string) {
  const accounts = await listAccounts(userId);

  return Promise.all(
    accounts.map(async (account) => {
      try {
        return { ...account, sites: await listSites(account.id), sitesError: null };
      } catch (err) {
        return {
          ...account,
          sites: [] as GscSite[],
          sitesError: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

/** ¿Tiene esta cuenta de la app alguna cuenta de Google conectada? */
export async function accountConnected(userId: string): Promise<boolean> {
  return (await listAccounts(userId)).length > 0;
}

/**
 * Cuenta de Google con la que se mide un proyecto, o null si no hay
 * ninguna utilizable. Los proyectos sin cuenta asignada (anteriores a las
 * multi-cuenta) usan la primera que se conectó.
 */
export async function resolveProjectAccount(project: {
  userId: string;
  gscAccountId: string | null;
}): Promise<string | null> {
  const accounts = await listAccounts(project.userId);

  if (project.gscAccountId) {
    return accounts.find((a) => a.id === project.gscAccountId)?.id ?? null;
  }
  return accounts[0]?.id ?? null;
}

/**
 * Fija la cuenta de los proyectos que tienen propiedad pero no cuenta
 * (venían de cuando sólo había una). Así, al conectar o quitar otras
 * cuentas, esos proyectos no cambian de cuenta sin que nadie lo decida.
 */
export async function adoptLegacyProjects(userId: string): Promise<void> {
  const [first] = await listAccounts(userId);
  if (!first) return;

  await prisma.project.updateMany({
    where: { userId, gscAccountId: null, gscSiteUrl: { not: null } },
    data: { gscAccountId: first.id },
  });
}
