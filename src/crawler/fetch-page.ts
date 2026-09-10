import { request } from 'undici';
import { env } from '../../lib/env';
import { assertSafeUrl, BlockedHostError } from './ssrf';
import type { CrawlErrorType, FetchResult } from './types';

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Descarta el cuerpo liberando la conexión.
 *
 * `destroy()` hace que undici emita un 'error' sin listener y tumbe el
 * proceso, así que usamos `dump()`, que consume y cierra en silencio.
 */
async function discardBody(body: { dump: () => Promise<void> }): Promise<void> {
  try {
    await body.dump();
  } catch {
    /* la conexión ya estaba cerrada */
  }
}

/** Content types que sí parseamos como HTML. */
export function isHtml(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml+xml');
}

function classifyError(err: unknown): {
  type: CrawlErrorType;
  message: string;
} {
  if (err instanceof BlockedHostError) {
    return { type: 'BLOCKED_HOST', message: err.message };
  }

  const e = err as { code?: string; name?: string; message?: string };
  const code = e?.code ?? '';
  const message = e?.message ?? String(err);

  if (e?.name === 'AbortError' || code === 'UND_ERR_HEADERS_TIMEOUT' ||
      code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { type: 'TIMEOUT', message };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { type: 'DNS_ERROR', message };
  }
  if (code.startsWith('ERR_TLS') || code === 'CERT_HAS_EXPIRED' ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return { type: 'TLS_ERROR', message };
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' ||
      code === 'ENETUNREACH' || code === 'EPIPE') {
    return { type: 'CONNECTION_ERROR', message };
  }
  return { type: 'UNKNOWN', message };
}

/**
 * Descarga una URL siguiendo redirects manualmente.
 *
 * Cada salto vuelve a pasar por `assertSafeUrl`, de modo que un redirect
 * hacia 127.0.0.1 o una IP privada se bloquea igual que la URL original.
 */
export async function fetchPage(
  url: string,
  options: {
    userAgent: string;
    timeoutMs?: number;
    maxRedirects?: number;
    /**
     * 'html' (por defecto) sólo descarga cuerpos HTML; 'always' descarga
     * cualquier content-type, que es lo que necesitan robots.txt y los
     * sitemaps XML.
     */
    readBody?: 'html' | 'always';
  },
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? env.crawler.timeoutMs;
  const maxRedirects = options.maxRedirects ?? env.crawler.maxRedirects;

  const started = Date.now();
  const redirectChain: string[] = [];
  let current = url;
  let firstRedirectTarget: string | null = null;
  let firstStatus: number | null = null;

  const base = (): FetchResult => ({
    url,
    finalUrl: current,
    statusCode: null,
    contentType: null,
    contentLength: null,
    responseTime: Date.now() - started,
    headers: {},
    body: null,
    redirectUrl: firstRedirectTarget,
    redirectChain,
    errorType: null,
    errorMessage: null,
  });

  for (let hop = 0; hop <= maxRedirects; hop++) {
    try {
      await assertSafeUrl(current);

      const res = await request(current, {
        method: 'GET',
        // `request` no sigue redirects por defecto: los gestionamos a mano
        // para revalidar el host en cada salto.
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        headers: {
          'user-agent': options.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': '*',
        },
      });

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      }

      const status = res.statusCode;
      const contentType = headers['content-type'] ?? null;
      if (firstStatus === null) firstStatus = status;

      // ---- Redirects
      if (REDIRECT_CODES.has(status) && headers['location']) {
        const next = new URL(headers['location'], current).toString();
        redirectChain.push(current);
        if (!firstRedirectTarget) firstRedirectTarget = next;

        await discardBody(res.body);

        if (redirectChain.includes(next)) {
          const result = base();
          result.statusCode = status;
          result.contentType = contentType;
          result.headers = headers;
          result.errorType = 'TOO_MANY_REDIRECTS';
          result.errorMessage = 'Redirect loop detectado';
          return result;
        }

        current = next;
        continue;
      }

      // ---- Cuerpo (con límite de tamaño)
      let body: string | null = null;
      let bytes = 0;
      let tooLarge = false;

      const declared = Number(headers['content-length'] ?? NaN);
      const shouldRead =
        options.readBody === 'always' || isHtml(contentType) || contentType === null;

      if (shouldRead && !(Number.isFinite(declared) && declared > env.crawler.maxHtmlBytes)) {
        const chunks: Buffer[] = [];
        for await (const chunk of res.body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buf.length;
          if (bytes > env.crawler.maxHtmlBytes) {
            tooLarge = true;
            await discardBody(res.body);
            break;
          }
          chunks.push(buf);
        }
        if (!tooLarge) body = Buffer.concat(chunks).toString('utf8');
      } else {
        await discardBody(res.body);
        if (Number.isFinite(declared) && declared > env.crawler.maxHtmlBytes) {
          tooLarge = true;
        }
      }

      const redirected = redirectChain.length > 0;

      const result = base();
      result.finalUrl = current;
      // En una cadena de redirecciones la URL solicitada "es" el 301/302:
      // el destino se rastrea por separado, así que no le robamos su status
      // ni guardamos su contenido bajo la URL de origen.
      result.statusCode = redirected ? firstStatus : status;
      result.contentType = contentType;
      result.contentLength = Number.isFinite(declared) ? declared : bytes || null;
      result.responseTime = Date.now() - started;
      result.headers = headers;
      result.body = redirected ? null : body;

      if (tooLarge) {
        result.errorType = 'TOO_LARGE';
        result.errorMessage = `Respuesta mayor a ${env.crawler.maxHtmlBytes} bytes`;
      } else if (
        !redirected &&
        options.readBody !== 'always' &&
        !isHtml(contentType) &&
        status < 400
      ) {
        result.errorType = 'UNSUPPORTED_CONTENT';
        result.errorMessage = contentType ?? 'sin content-type';
      }

      return result;
    } catch (err) {
      const { type, message } = classifyError(err);
      const result = base();
      result.errorType = type;
      result.errorMessage = message;
      result.responseTime = Date.now() - started;
      return result;
    }
  }

  const result = base();
  result.errorType = 'TOO_MANY_REDIRECTS';
  result.errorMessage = `Más de ${maxRedirects} redirects`;
  return result;
}
