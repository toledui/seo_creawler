import { issue, type SeoRule } from './types';

/** 4xx en una URL interna: enlace roto dentro del propio sitio. */
export const clientErrorRule: SeoRule = {
  code: 'HTTP_4XX',
  severity: 'HIGH',
  title: 'Error 4xx interno',
  description: 'La URL interna devuelve un código de estado 4xx.',
  run(page) {
    const status = page.statusCode ?? 0;
    if (status < 400 || status >= 500) return [];
    return [
      issue(page, clientErrorRule, `Status ${status} con ${page.internalInlinks} enlaces internos entrantes`),
    ];
  },
};

/** 5xx: error de servidor. */
export const serverErrorRule: SeoRule = {
  code: 'HTTP_5XX',
  severity: 'CRITICAL',
  title: 'Error 5xx',
  description: 'La URL devuelve un error de servidor.',
  run(page) {
    const status = page.statusCode ?? 0;
    if (status < 500) return [];
    return [issue(page, serverErrorRule, `Status ${status}`)];
  },
};

/** Fallos de red, DNS, TLS o timeout. */
export const fetchErrorRule: SeoRule = {
  code: 'FETCH_ERROR',
  severity: 'HIGH',
  title: 'URL no accesible',
  description: 'No se pudo descargar la URL (DNS, timeout, TLS o conexión).',
  run(page) {
    if (!page.errorType) return [];
    const ignored = ['UNSUPPORTED_CONTENT', 'BLOCKED_ROBOTS'];
    if (ignored.includes(page.errorType)) return [];
    return [issue(page, fetchErrorRule, page.errorType)];
  },
};
