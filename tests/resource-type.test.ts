import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyResource,
  extensionOf,
  mediaTypeFromExtension,
  mediaTypeFromMime,
  normalizeContentType,
} from '../src/crawler/resource-type';

/** Atajo: respuesta 200 con un Content-Type dado. */
function ok(url: string, contentType: string | null) {
  return classifyResource({ url, statusCode: 200, contentType });
}

describe('normalizeContentType', () => {
  it('quita parámetros y normaliza a minúsculas', () => {
    assert.equal(normalizeContentType('text/html; charset=UTF-8'), 'text/html');
    assert.equal(normalizeContentType('  TEXT/HTML  '), 'text/html');
    assert.equal(normalizeContentType('image/WebP;q=1'), 'image/webp');
  });

  it('devuelve null si no es un MIME válido', () => {
    assert.equal(normalizeContentType(null), null);
    assert.equal(normalizeContentType(''), null);
    assert.equal(normalizeContentType('no-es-un-mime'), null);
    assert.equal(normalizeContentType('; charset=utf-8'), null);
  });
});

describe('clasificación por Content-Type (señal principal)', () => {
  it('1. HTML válido con Content-Type: text/html', () => {
    const c = ok('https://ejemplo.com/servicios', 'text/html');
    assert.equal(c.resourceType, 'HTML_PAGE');
    assert.equal(c.mimeSource, 'header');
    assert.equal(c.isHtmlDocument, true);
  });

  it('2. HTML con charset en el Content-Type', () => {
    const c = ok('https://ejemplo.com/', 'text/html; charset=UTF-8');
    assert.equal(c.resourceType, 'HTML_PAGE');
    assert.equal(c.mimeType, 'text/html');
  });

  it('3. XHTML', () => {
    const c = ok('https://ejemplo.com/doc', 'application/xhtml+xml');
    assert.equal(c.resourceType, 'HTML_PAGE');
    assert.equal(c.isHtmlDocument, true);
  });

  it('4. Imagen WebP', () => {
    const c = ok('https://ejemplo.com/wp-content/uploads/2024/foto.webp', 'image/webp');
    assert.equal(c.resourceType, 'IMAGE');
    assert.equal(c.isHtmlDocument, false);
  });

  it('5. JPG y PNG', () => {
    assert.equal(ok('https://e.com/a.jpg', 'image/jpeg').resourceType, 'IMAGE');
    assert.equal(ok('https://e.com/a.png', 'image/png').resourceType, 'IMAGE');
  });

  it('6. SVG', () => {
    const c = ok('https://e.com/logo.svg', 'image/svg+xml');
    assert.equal(c.resourceType, 'IMAGE');
    // Es XML, pero NO es un documento que deba pasar por reglas on-page.
    assert.equal(c.isHtmlDocument, false);
  });

  it('7. CSS', () => {
    assert.equal(ok('https://e.com/style.css', 'text/css').resourceType, 'CSS');
  });

  it('8. JavaScript', () => {
    assert.equal(ok('https://e.com/app.js', 'application/javascript').resourceType, 'JAVASCRIPT');
    assert.equal(ok('https://e.com/app.js', 'text/javascript').resourceType, 'JAVASCRIPT');
  });

  it('9. Fuentes', () => {
    assert.equal(ok('https://e.com/f.woff2', 'font/woff2').resourceType, 'FONT');
    assert.equal(ok('https://e.com/f.ttf', 'font/ttf').resourceType, 'FONT');
    assert.equal(
      ok('https://e.com/f.eot', 'application/vnd.ms-fontobject').resourceType,
      'FONT',
    );
  });

  it('10. PDF', () => {
    assert.equal(ok('https://e.com/dossier.pdf', 'application/pdf').resourceType, 'PDF');
  });

  it('un MIME desconocido pero válido es OTHER_ASSET, no una página', () => {
    const c = ok('https://e.com/datos', 'application/vnd.acme.cosa');
    assert.equal(c.resourceType, 'OTHER_ASSET');
    assert.equal(c.isHtmlDocument, false);
  });
});

describe('la extensión es sólo señal secundaria', () => {
  it('11. Content-Type ausente con extensión reconocible', () => {
    const c = ok('https://e.com/wp-content/uploads/foto.webp', null);
    assert.equal(c.resourceType, 'IMAGE');
    assert.equal(c.mimeSource, 'extension');
  });

  it('12. Content-Type genérico application/octet-stream', () => {
    const c = ok('https://e.com/uploads/foto.jpg', 'application/octet-stream');
    assert.equal(c.resourceType, 'IMAGE');
    assert.equal(c.mimeSource, 'extension');
  });

  it('un octet-stream sin extensión reconocible queda UNKNOWN', () => {
    const c = ok('https://e.com/descarga', 'application/octet-stream');
    assert.equal(c.resourceType, 'UNKNOWN');
    assert.equal(c.mimeSource, 'none');
    assert.equal(c.isHtmlDocument, false);
  });

  it('13. URL sin extensión con Content-Type válido manda la cabecera', () => {
    assert.equal(ok('https://e.com/servicios/consultoria', 'text/html').resourceType, 'HTML_PAGE');
    assert.equal(ok('https://e.com/cdn/asset/12345', 'image/avif').resourceType, 'IMAGE');
  });

  it('14. URL de imagen con query string', () => {
    const c = ok('https://e.com/uploads/foto.jpg?w=800&quality=75&v=2', 'image/jpeg');
    assert.equal(c.resourceType, 'IMAGE');
    assert.equal(extensionOf('https://e.com/uploads/foto.jpg?w=800'), 'jpg');
  });

  it('una URL de CDN con parámetros en el path se clasifica por cabecera', () => {
    const c = ok('https://e.com/cdn-cgi/image/w=800,q=75/foto.webp', 'image/webp');
    assert.equal(c.resourceType, 'IMAGE');
  });

  it('23. extensión .jpg servida como image/webp: gana la cabecera, se marca la discrepancia', () => {
    const c = ok('https://e.com/uploads/foto.jpg', 'image/webp');
    assert.equal(c.resourceType, 'IMAGE');
    assert.equal(c.mimeType, 'image/webp');
    assert.equal(c.expectedMime, 'image/jpeg');
    assert.equal(c.extensionMismatch, true);
  });

  it('una cabecera válida y coherente no genera discrepancia', () => {
    assert.equal(ok('https://e.com/a.png', 'image/png').extensionMismatch, false);
    // Un octet-stream no cuenta como discrepancia: es simplemente genérico.
    assert.equal(ok('https://e.com/a.png', 'application/octet-stream').extensionMismatch, false);
  });

  it('una extensión de página servida como imagen se clasifica como imagen', () => {
    const c = ok('https://e.com/pagina.html', 'image/png');
    assert.equal(c.resourceType, 'IMAGE');
    assert.equal(c.extensionMismatch, true);
  });
});

describe('redirecciones y errores', () => {
  it('15. redirección que termina en HTML', () => {
    const c = classifyResource({
      url: 'https://e.com/vieja',
      finalUrl: 'https://e.com/nueva',
      statusCode: 301,
      contentType: 'text/html; charset=UTF-8',
      redirectChain: ['https://e.com/vieja'],
    });
    assert.equal(c.resourceType, 'REDIRECT');
    assert.equal(c.redirected, true);
    // Tras seguir la redirección, el recurso final es una página HTML.
    assert.equal(c.finalResourceType, 'HTML_PAGE');
    assert.equal(c.mediaType, 'HTML_PAGE');
  });

  it('16. redirección que termina en una imagen', () => {
    const c = classifyResource({
      url: 'https://e.com/foto',
      finalUrl: 'https://cdn.e.com/foto.webp',
      statusCode: 302,
      contentType: 'image/webp',
      redirectChain: ['https://e.com/foto'],
    });
    assert.equal(c.resourceType, 'REDIRECT');
    assert.equal(c.finalResourceType, 'IMAGE');
    assert.equal(c.isHtmlDocument, false);
  });

  it('17. imagen con respuesta 404', () => {
    const c = classifyResource({
      url: 'https://e.com/wp-content/uploads/borrada.webp',
      statusCode: 404,
      contentType: 'text/html; charset=UTF-8',
    });
    // La respuesta es un error…
    assert.equal(c.resourceType, 'ERROR');
    assert.equal(c.finalResourceType, 'ERROR');
    // …pero seguimos sabiendo que el recurso pedido era una imagen, para
    // poder reportarla como imagen rota: en un error, el text/html describe
    // la plantilla de la 404, no el archivo solicitado.
    assert.equal(c.mediaType, 'IMAGE');
    assert.equal(c.isHtmlDocument, false);
  });

  it('17b. imagen 404 servida como imagen conserva mediaType IMAGE', () => {
    const c = classifyResource({
      url: 'https://e.com/uploads/borrada.webp',
      statusCode: 404,
      contentType: null,
    });
    assert.equal(c.resourceType, 'ERROR');
    assert.equal(c.mediaType, 'IMAGE');
  });

  it('24. página HTML 404 personalizada no es una página válida', () => {
    const c = classifyResource({
      url: 'https://e.com/no-existe',
      statusCode: 404,
      contentType: 'text/html; charset=UTF-8',
    });
    assert.equal(c.resourceType, 'ERROR');
    assert.equal(c.isHtmlDocument, false);
  });

  it('un fallo de red se clasifica como ERROR', () => {
    const c = classifyResource({
      url: 'https://e.com/lenta',
      statusCode: null,
      contentType: null,
      errorType: 'TIMEOUT',
    });
    assert.equal(c.resourceType, 'ERROR');
  });

  it('UNSUPPORTED_CONTENT no convierte un asset entregado en error', () => {
    const c = classifyResource({
      url: 'https://e.com/a.webp',
      statusCode: 200,
      contentType: 'image/webp',
      errorType: 'UNSUPPORTED_CONTENT',
    });
    assert.equal(c.resourceType, 'IMAGE');
  });

  it('5xx es ERROR aunque devuelva HTML', () => {
    const c = classifyResource({
      url: 'https://e.com/',
      statusCode: 503,
      contentType: 'text/html',
    });
    assert.equal(c.resourceType, 'ERROR');
  });
});

describe('helpers', () => {
  it('extensionOf ignora query, fragmento y puntos del dominio', () => {
    assert.equal(extensionOf('https://e.com/a/b/c.WEBP?x=1#y'), 'webp');
    assert.equal(extensionOf('https://e.com/servicios/'), null);
    assert.equal(extensionOf('https://e.com'), null);
    assert.equal(extensionOf('/relativa/foto.png'), 'png');
  });

  it('mediaTypeFromMime cubre el vocabulario exigido', () => {
    assert.equal(mediaTypeFromMime('text/html'), 'HTML_PAGE');
    assert.equal(mediaTypeFromMime('application/xhtml+xml'), 'HTML_PAGE');
    assert.equal(mediaTypeFromMime('image/svg+xml'), 'IMAGE');
    assert.equal(mediaTypeFromMime('application/octet-stream'), null);
  });

  it('mediaTypeFromExtension no inventa páginas donde no las hay', () => {
    assert.equal(mediaTypeFromExtension('https://e.com/a.webp'), 'IMAGE');
    assert.equal(mediaTypeFromExtension('https://e.com/a.zip'), 'OTHER_ASSET');
    assert.equal(mediaTypeFromExtension('https://e.com/a'), null);
  });
});
