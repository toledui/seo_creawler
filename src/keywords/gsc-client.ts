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

/** URL a la que enviamos al usuario para que autorice el acceso. */
export async function buildAuthUrl(state: string): Promise<string> {
  const settings = await getAppSettings();
  if (!settings.google.configured) throw new GscNotConfiguredError();

  const params = new URLSearchParams({
    client_id: settings.google.clientId!,
    redirect_uri: await oauthRedirectUri(),
    response_type: 'code',
    scope: GSC_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
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

/** Guarda (cifrados) los tokens de una cuenta. */
export async function saveTokens(
  userId: string,
  tokens: TokenResponse,
): Promise<void> {
  const data = {
    accessToken: encrypt(tokens.access_token),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    googleEmail: emailFromIdToken(tokens.id_token),
    lastError: null,
    ...(tokens.refresh_token
      ? { refreshToken: encrypt(tokens.refresh_token) }
      : {}),
  };

  await prisma.gscAccount.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/** Devuelve un access token válido para la cuenta, renovándolo si hace falta. */
export async function accessTokenFor(userId: string): Promise<string> {
  const account = await prisma.gscAccount.findUnique({ where: { userId } });
  if (!account) throw new GscError('La cuenta no está conectada a Search Console');

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
    where: { userId },
    data: {
      accessToken: encrypt(refreshed.access_token),
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      lastError: null,
    },
  });

  return refreshed.access_token;
}

export type GscSite = { siteUrl: string; permissionLevel: string };

/** Propiedades a las que tiene acceso la cuenta conectada. */
export async function listSites(userId: string): Promise<GscSite[]> {
  const token = await accessTokenFor(userId);
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
  userId: string,
  options: {
    siteUrl: string;
    startDate: string;
    endDate: string;
    rowLimit?: number;
    startRow?: number;
    dimensions?: ('query' | 'page' | 'country' | 'device' | 'date')[];
  },
): Promise<GscQueryRow[]> {
  const token = await accessTokenFor(userId);
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

/** ¿Está esta cuenta conectada y con refresh token utilizable? */
export async function accountConnected(userId: string): Promise<boolean> {
  const account = await prisma.gscAccount.findUnique({
    where: { userId },
    select: { refreshToken: true },
  });
  return Boolean(decrypt(account?.refreshToken));
}
