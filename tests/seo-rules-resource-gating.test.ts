import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyResource } from '../src/crawler/resource-type';
import { pageRules } from '../src/seo/rules';
import type { PageContext } from '../src/seo/rules/types';

/** Códigos que SÓLO pueden nacer del DOM de un documento HTML. */
const HTML_ONLY_CODES = [
  'MISSING_TITLE',
  'TITLE_TOO_LONG',
  'TITLE_TOO_SHORT',
  'MISSING_DESCRIPTION',
  'DESCRIPTION_TOO_LONG',
  'DESCRIPTION_TOO_SHORT',
  'MISSING_H1',
  'MULTIPLE_H1',
  'MISSING_CANONICAL',
  'CANONICALIZED',
  'NOINDEX',
  'THIN_CONTENT',
  'DEEP_PAGE',
  'LOW_INLINKS',
  'POTENTIAL_ORPHAN',
  'IMAGES_MISSING_ALT',
  'IMAGES_DECORATIVE_ALT',
];

let nextId = 1n;

/**
 * Construye un `PageContext` como lo haría el crawler: la clasificación
 * sale de la respuesta HTTP real, no de suposiciones sobre la URL.
 */
function pageFrom(input: {
  url: string;
  statusCode: number | null;
  contentType: string | null;
  errorType?: string | null;
  redirectChain?: string[];
  overrides?: Partial<PageContext>;
}): PageContext {
  const c = classifyResource({
    url: input.url,
    statusCode: input.statusCode,
    contentType: input.contentType,
    errorType: input.errorType ?? null,
    redirectChain: input.redirectChain ?? null,
  });

  return {
    id: nextId++,
    url: input.url,
    normalizedUrl: input.url,
    statusCode: input.statusCode,
    errorType: input.errorType ?? null,
    contentType: input.contentType,
    resourceType: c.resourceType,
    mediaType: c.mediaType,
    mimeType: c.mimeType,
    mimeMismatch: c.extensionMismatch,
    title: null,
    titleLength: null,
    metaDescription: null,
    metaDescriptionLength: null,
    h1: null,
    h1Count: 0,
    canonical: null,
    metaRobots: null,
    wordCount: 0,
    depth: 2,
    indexable: c.resourceType === 'HTML_PAGE',
    indexabilityReason: c.resourceType === 'HTML_PAGE' ? 'INDEXABLE' : 'UNSUPPORTED_CONTENT',
    internalInlinks: 3,
    imagesCount: 0,
    imagesMissingAlt: 0,
    imagesDecorative: 0,
    inSitemap: false,
    potentialOrphan: false,
    redirectUrl: null,
    ...input.overrides,
  };
}

function codesFor(page: PageContext): string[] {
  return pageRules.flatMap((rule) => rule.run(page)).map((i) => i.code);
}

describe('regresión: un asset nunca dispara reglas exclusivas de HTML', () => {
  const assets: [string, string, string][] = [
    ['image/webp', 'https://e.com/wp-content/uploads/2024/10/foto.webp', 'IMAGE'],
    ['image/jpeg', 'https://e.com/wp-content/uploads/2024/10/foto.jpg', 'IMAGE'],
    ['image/png', 'https://e.com/wp-content/uploads/logo.png', 'IMAGE'],
    ['image/svg+xml', 'https://e.com/wp-content/uploads/icono.svg', 'IMAGE'],
    ['text/css', 'https://e.com/wp-content/themes/x/style.css', 'CSS'],
    ['application/javascript', 'https://e.com/wp-includes/js/app.js', 'JAVASCRIPT'],
    ['font/woff2', 'https://e.com/fonts/inter.woff2', 'FONT'],
    ['application/pdf', 'https://e.com/docs/dossier.pdf', 'PDF'],
  ];

  for (const [contentType, url, expected] of assets) {
    it(`${contentType} → ${expected} y cero incidencias on-page`, () => {
      const page = pageFrom({ url, statusCode: 200, contentType });
      assert.equal(page.resourceType, expected);

      const codes = codesFor(page);
      for (const code of HTML_ONLY_CODES) {
        assert.ok(
          !codes.includes(code),
          `${expected} no debe generar ${code}; generó: ${codes.join(', ') || '(ninguna)'}`,
        );
      }
    });
  }

  it('un image/webp no genera title, meta description, H1 ni canonical', () => {
    const page = pageFrom({
      url: 'https://novemp.com.mx/wp-content/uploads/2024/11/plataforma.webp',
      statusCode: 200,
      contentType: 'image/webp',
    });
    const codes = codesFor(page);
    assert.deepEqual(
      codes.filter((c) =>
        ['MISSING_TITLE', 'MISSING_DESCRIPTION', 'MISSING_H1', 'MISSING_CANONICAL'].includes(c),
      ),
      [],
    );
  });

  it('un asset sin Content-Type pero con extensión de imagen tampoco', () => {
    const page = pageFrom({
      url: 'https://e.com/wp-content/uploads/foto.webp',
      statusCode: 200,
      contentType: null,
    });
    assert.equal(page.resourceType, 'IMAGE');
    assert.ok(!codesFor(page).includes('MISSING_TITLE'));
  });

  it('un octet-stream sin extensión (UNKNOWN) tampoco se audita como página', () => {
    const page = pageFrom({
      url: 'https://e.com/descarga/12345',
      statusCode: 200,
      contentType: 'application/octet-stream',
    });
    assert.equal(page.resourceType, 'UNKNOWN');
    for (const code of HTML_ONLY_CODES) {
      assert.ok(!codesFor(page).includes(code));
    }
  });
});

describe('los errores reales de los recursos se siguen detectando', () => {
  it('17. una imagen 404 se reporta como recurso roto, no como página sin title', () => {
    const page = pageFrom({
      url: 'https://e.com/wp-content/uploads/borrada.webp',
      statusCode: 404,
      contentType: null,
    });
    const codes = codesFor(page);
    assert.ok(codes.includes('HTTP_4XX'));
    assert.ok(codes.includes('BROKEN_ASSET'));
    assert.ok(!codes.includes('MISSING_TITLE'));
    assert.ok(!codes.includes('MISSING_H1'));
  });

  it('un CSS 500 sigue siendo un error crítico', () => {
    const page = pageFrom({
      url: 'https://e.com/style.css',
      statusCode: 500,
      contentType: 'text/css',
    });
    const codes = codesFor(page);
    assert.ok(codes.includes('HTTP_5XX'));
    assert.ok(codes.includes('BROKEN_ASSET'));
  });

  it('un timeout sobre un asset sigue siendo FETCH_ERROR', () => {
    const page = pageFrom({
      url: 'https://e.com/foto.jpg',
      statusCode: null,
      contentType: null,
      errorType: 'TIMEOUT',
    });
    const codes = codesFor(page);
    assert.ok(codes.includes('FETCH_ERROR'));
    assert.ok(!codes.includes('MISSING_TITLE'));
  });

  it('23. la discrepancia extensión/Content-Type se reporta como MIME_MISMATCH', () => {
    const page = pageFrom({
      url: 'https://e.com/uploads/foto.jpg',
      statusCode: 200,
      contentType: 'image/webp',
    });
    const codes = codesFor(page);
    assert.ok(codes.includes('MIME_MISMATCH'));
    assert.ok(!codes.includes('MISSING_TITLE'));
  });

  it('16. una redirección que acaba en imagen se reporta como redirección', () => {
    const page = pageFrom({
      url: 'https://e.com/foto',
      statusCode: 301,
      contentType: 'image/webp',
      redirectChain: ['https://e.com/foto'],
      overrides: { redirectUrl: 'https://cdn.e.com/foto.webp' },
    });
    assert.equal(page.resourceType, 'REDIRECT');
    const codes = codesFor(page);
    assert.ok(codes.includes('REDIRECT'));
    assert.ok(!codes.includes('MISSING_TITLE'));
  });
});

describe('las páginas HTML reales se siguen auditando igual', () => {
  it('una página HTML sin metadatos sigue generando todas sus incidencias', () => {
    const page = pageFrom({
      url: 'https://e.com/servicios/consultoria',
      statusCode: 200,
      contentType: 'text/html; charset=UTF-8',
      overrides: { wordCount: 40, depth: 6, internalInlinks: 1 },
    });
    const codes = codesFor(page);
    assert.ok(codes.includes('MISSING_TITLE'));
    assert.ok(codes.includes('MISSING_DESCRIPTION'));
    assert.ok(codes.includes('MISSING_H1'));
    assert.ok(codes.includes('MISSING_CANONICAL'));
    assert.ok(codes.includes('THIN_CONTENT'));
    assert.ok(codes.includes('DEEP_PAGE'));
    assert.ok(codes.includes('LOW_INLINKS'));
  });

  it('2. el charset en el Content-Type no impide auditar la página', () => {
    const page = pageFrom({
      url: 'https://e.com/a',
      statusCode: 200,
      contentType: 'text/html; charset=iso-8859-1',
    });
    assert.ok(codesFor(page).includes('MISSING_TITLE'));
  });

  it('3. XHTML se audita como página HTML', () => {
    const page = pageFrom({
      url: 'https://e.com/doc',
      statusCode: 200,
      contentType: 'application/xhtml+xml',
    });
    assert.ok(codesFor(page).includes('MISSING_TITLE'));
  });

  it('13. una URL sin extensión servida como HTML se audita con normalidad', () => {
    const page = pageFrom({
      url: 'https://e.com/servicios/consultoria-seo',
      statusCode: 200,
      contentType: 'text/html',
    });
    assert.ok(codesFor(page).includes('MISSING_H1'));
  });

  it('18/19/20. sólo los <img> SIN atributo alt generan incidencia', () => {
    const sinAlt = pageFrom({
      url: 'https://e.com/a',
      statusCode: 200,
      contentType: 'text/html',
      overrides: { imagesCount: 3, imagesMissingAlt: 1, imagesDecorative: 1 },
    });
    const codes = codesFor(sinAlt);
    assert.ok(codes.includes('IMAGES_MISSING_ALT'));
    // alt="" aparece aparte y como INFO, nunca como "alt ausente".
    assert.ok(codes.includes('IMAGES_DECORATIVE_ALT'));

    const soloDecorativas = pageFrom({
      url: 'https://e.com/b',
      statusCode: 200,
      contentType: 'text/html',
      overrides: { imagesCount: 4, imagesMissingAlt: 0, imagesDecorative: 4 },
    });
    const codes2 = codesFor(soloDecorativas);
    assert.ok(
      !codes2.includes('IMAGES_MISSING_ALT'),
      'alt="" no puede reportarse como atributo alt ausente',
    );
    assert.ok(codes2.includes('IMAGES_DECORATIVE_ALT'));
    const decorativa = pageRules
      .flatMap((r) => r.run(soloDecorativas))
      .find((i) => i.code === 'IMAGES_DECORATIVE_ALT');
    assert.equal(decorativa?.severity, 'INFO');
  });

  it('24. una 404 con plantilla HTML no contamina las métricas on-page', () => {
    const page = pageFrom({
      url: 'https://e.com/pagina-que-no-existe',
      statusCode: 404,
      contentType: 'text/html; charset=UTF-8',
      overrides: { title: 'Error 404 - Página no encontrada', wordCount: 12 },
    });
    const codes = codesFor(page);
    assert.ok(codes.includes('HTTP_4XX'));
    for (const code of HTML_ONLY_CODES) {
      assert.ok(!codes.includes(code), `una 404 no debe generar ${code}`);
    }
  });

  it('una 404 HTML no se cuenta como recurso roto (no es un asset)', () => {
    const page = pageFrom({
      url: 'https://e.com/no-existe',
      statusCode: 404,
      contentType: 'text/html',
    });
    assert.ok(!codesFor(page).includes('BROKEN_ASSET'));
  });

  it('compatibilidad: sin resourceType se deduce del Content-Type', () => {
    const page = pageFrom({
      url: 'https://e.com/a',
      statusCode: 200,
      contentType: 'text/html',
      overrides: { resourceType: null, mediaType: null },
    });
    assert.ok(codesFor(page).includes('MISSING_TITLE'));

    const asset = pageFrom({
      url: 'https://e.com/a.webp',
      statusCode: 200,
      contentType: 'image/webp',
      overrides: { resourceType: null, mediaType: null },
    });
    assert.ok(!codesFor(asset).includes('MISSING_TITLE'));
  });
});
