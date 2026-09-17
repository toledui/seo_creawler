import { isAssetResource } from '../../crawler/resource-type';
import { issue, type SeoRule } from './types';

/**
 * Reglas que auditan un recurso COMO recurso: que exista, que responda
 * bien y que el servidor lo declare con el tipo correcto.
 *
 * Los errores HTTP (4xx/5xx) y de red los cubren `broken-page.ts` y
 * `technical.ts`, que se aplican a cualquier URL sea cual sea su tipo.
 */

/** El servidor declara un MIME que no corresponde con la extensión. */
export const mimeMismatchRule: SeoRule = {
  code: 'MIME_MISMATCH',
  severity: 'LOW',
  title: 'Extensión y Content-Type no coinciden',
  description:
    'La extensión de la URL anuncia un formato y el servidor devuelve otro distinto (p. ej. .jpg servido como image/webp).',
  run(page) {
    if (!page.mimeMismatch) return [];
    if (page.statusCode == null || page.statusCode >= 300) return [];
    return [
      issue(
        page,
        mimeMismatchRule,
        `Content-Type: ${page.mimeType ?? 'desconocido'}`,
      ),
    ];
  },
};

/**
 * Un asset (imagen, CSS, JS, fuente, PDF) que no se entrega.
 *
 * Es informativa respecto a HTTP_4XX/HTTP_5XX: aquí lo relevante es que
 * el recurso está roto, y en el reporte se cruza con las páginas que lo
 * usan. Sólo se emite cuando la URL del asset se solicitó directamente.
 */
export const brokenAssetRule: SeoRule = {
  code: 'BROKEN_ASSET',
  severity: 'MEDIUM',
  title: 'Recurso roto',
  description:
    'Una imagen, hoja de estilos, script, fuente o documento no se puede descargar.',
  run(page) {
    if (!isAssetResource(page.mediaType)) return [];
    // robots.txt bloqueándolo no es un recurso roto: tiene su propia regla.
    if (page.errorType === 'BLOCKED_ROBOTS') return [];
    const status = page.statusCode;
    const failed = status == null || status >= 400;
    if (!failed) return [];
    return [
      issue(
        page,
        brokenAssetRule,
        `${page.mediaType} · ${status != null ? `Status ${status}` : (page.errorType ?? 'sin respuesta')}`,
      ),
    ];
  },
};

export const assetRules: SeoRule[] = [mimeMismatchRule, brokenAssetRule];
