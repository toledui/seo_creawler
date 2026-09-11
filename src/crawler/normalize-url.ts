import { createHash } from 'node:crypto';

/** Parámetros de tracking que no cambian el contenido de la página. */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'yclid',
  'igshid',
  'ref_src',
]);

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Normaliza una URL de forma determinística para poder deduplicar.
 *
 * - resuelve URLs relativas contra `baseUrl`
 * - fuerza minúsculas en protocolo y hostname (nunca en el path)
 * - elimina el fragmento (#seccion)
 * - elimina puerto por defecto (:80 / :443)
 * - elimina parámetros de tracking y ordena el resto
 * - normaliza el trailing slash (la raíz siempre queda como "/")
 *
 * Devuelve `null` si la URL no es http(s) o no es parseable.
 */
export function normalizeUrl(url: string, baseUrl?: string): string | null {
  if (!url) return null;

  const raw = url.trim();
  if (!raw) return null;

  // Descartamos esquemas no navegables antes de intentar parsear.
  const lower = raw.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('data:') ||
    lower.startsWith('ftp:') ||
    lower.startsWith('gopher:') ||
    lower.startsWith('file:') ||
    lower.startsWith('#')
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  if (!parsed.hostname) return null;

  // Endpoints internos de Cloudflare (email-protection, challenge-platform, trace…):
  // los reescribe el proxy en el HTML y solo funcionan con su JS, no son páginas reales.
  if (parsed.pathname.toLowerCase().startsWith('/cdn-cgi/')) return null;

  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  parsed.protocol = parsed.protocol.toLowerCase();

  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Query: quitamos tracking y ordenamos para que el hash sea estable.
  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  parsed.search = '';
  for (const [key, value] of params) parsed.searchParams.append(key, value);

  // Path: colapsamos slashes repetidos y dejamos "/" en la raíz.
  let path = parsed.pathname.replace(/\/{2,}/g, '/');
  if (path === '') path = '/';
  parsed.pathname = path;

  return parsed.toString();
}

/** SHA-256 de la URL normalizada; se usa como clave de deduplicación. */
export function urlHash(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

export function normalizeWithHash(
  url: string,
  baseUrl?: string,
): { normalizedUrl: string; hash: string } | null {
  const normalized = normalizeUrl(url, baseUrl);
  if (!normalized) return null;
  return { normalizedUrl: normalized, hash: urlHash(normalized) };
}

/** Quita "www." para poder comparar dominios de forma laxa. */
export function rootHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/** true si `candidate` pertenece al mismo sitio que `origin`. */
export function isSameSite(
  candidate: string,
  origin: string,
  followSubdomains: boolean,
): boolean {
  try {
    const a = new URL(candidate).hostname.toLowerCase();
    const b = new URL(origin).hostname.toLowerCase();
    if (a === b) return true;
    if (rootHost(a) === rootHost(b)) return true;
    if (followSubdomains) {
      const root = rootHost(b);
      return a === root || a.endsWith(`.${root}`);
    }
    return false;
  } catch {
    return false;
  }
}

/** Primer segmento del path; se usa para agrupar por directorio. */
export function directoryOf(url: string): string {
  try {
    const { pathname } = new URL(url);
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return '/';
    if (segments.length === 1 && segments[0].includes('.')) return '/';
    return `/${segments[0]}`;
  } catch {
    return '/';
  }
}
