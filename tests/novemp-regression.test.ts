import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyResource } from '../src/crawler/resource-type';
import { normalizeWithHash } from '../src/crawler/normalize-url';
import { parseHtml } from '../src/crawler/parse-html';
import { summarizeImageElements } from '../src/seo/image-audit';
import { pageRules } from '../src/seo/rules';
import type { PageContext } from '../src/seo/rules/types';
import { FIXTURE_CONSTANTS, novempFixture } from './fixtures/novemp-crawl';

/**
 * Reproduce el pipeline del crawler sobre respuestas locales: clasificar →
 * parsear sólo si es HTML → aplicar reglas → agregar métricas.
 *
 * Sin base de datos y sin red, pero usando el código real de clasificación,
 * parseo y reglas. Las cifras se comparan con las del informe anterior.
 */
type CrawledRow = {
  page: PageContext;
  images: { hasAlt: boolean; alt: string | null; pageKey: string; src: string }[];
  issues: string[];
};

function runPipeline(): CrawledRow[] {
  const rows: CrawledRow[] = [];
  let id = 1n;

  for (const response of novempFixture()) {
    const c = classifyResource({
      url: response.url,
      finalUrl: response.finalUrl ?? null,
      statusCode: response.statusCode,
      contentType: response.contentType,
      errorType: response.errorType ?? null,
      redirectChain: response.redirectChain ?? null,
    });

    // Sólo se parsea DOM cuando el recurso final es un documento HTML.
    const parsed =
      c.isHtmlDocument && response.html ? parseHtml(response.html, response.url) : null;

    const images = (parsed?.images ?? []).map((i) => ({
      hasAlt: i.hasAlt,
      alt: i.alt,
      pageKey: response.url,
      src: normalizeWithHash(i.src, response.url)?.normalizedUrl ?? i.src,
    }));

    const page: PageContext = {
      id: id++,
      url: response.url,
      normalizedUrl: response.url,
      statusCode: response.statusCode,
      errorType: response.errorType ?? null,
      contentType: response.contentType,
      resourceType: c.resourceType,
      mediaType: c.mediaType,
      mimeType: c.mimeType,
      mimeMismatch: c.extensionMismatch,
      title: parsed?.title ?? null,
      titleLength: parsed?.title?.length ?? null,
      metaDescription: parsed?.metaDescription ?? null,
      metaDescriptionLength: parsed?.metaDescription?.length ?? null,
      h1: parsed?.h1 ?? null,
      h1Count: parsed?.h1Count ?? 0,
      canonical: parsed?.canonical ?? null,
      metaRobots: parsed?.metaRobots ?? null,
      wordCount: parsed?.wordCount ?? 0,
      depth: 2,
      indexable: c.resourceType === 'HTML_PAGE',
      indexabilityReason:
        c.resourceType === 'HTML_PAGE' ? 'INDEXABLE' : 'UNSUPPORTED_CONTENT',
      internalInlinks: 5,
      imagesCount: images.length,
      imagesMissingAlt: images.filter((i) => !i.hasAlt).length,
      imagesDecorative: images.filter((i) => i.hasAlt && !(i.alt ?? '').trim()).length,
      inSitemap: false,
      potentialOrphan: false,
      redirectUrl: response.finalUrl ?? null,
    };

    rows.push({
      page,
      images,
      issues: pageRules.flatMap((rule) => rule.run(page)).map((i) => i.code),
    });
  }

  return rows;
}

const rows = runPipeline();
const isHtmlPage = (r: CrawledRow) => r.page.resourceType === 'HTML_PAGE';
const countIssue = (code: string) =>
  rows.reduce((n, r) => n + r.issues.filter((c) => c === code).length, 0);
const issuesOnAssets = (code: string) =>
  rows.filter((r) => !isHtmlPage(r) && r.issues.includes(code));

describe('caso Novemp: el crawl tiene la forma del informe anterior', () => {
  it('se solicitaron 158 URLs', () => {
    assert.equal(rows.length, FIXTURE_CONSTANTS.TOTAL_URLS);
  });

  it('54 de ellas son archivos de /wp-content/uploads/', () => {
    const uploads = rows.filter((r) => r.page.url.includes('/wp-content/uploads/'));
    assert.equal(uploads.length, FIXTURE_CONSTANTS.UPLOADS);
  });
});

describe('después de la corrección: los assets ya no son páginas', () => {
  it('los 54 archivos siguen apareciendo como recursos descubiertos', () => {
    const uploads = rows.filter((r) => r.page.url.includes('/wp-content/uploads/'));
    assert.equal(uploads.length, 54);
    // Ninguno se clasifica como página HTML.
    assert.equal(uploads.filter(isHtmlPage).length, 0);
  });

  it('ninguno se cuenta como página HTML analizada', () => {
    const htmlPages = rows.filter(isHtmlPage);
    const requested = rows.length;
    assert.ok(htmlPages.length < requested);
    assert.equal(
      htmlPages.filter((r) => r.page.url.includes('/wp-content/uploads/')).length,
      0,
    );
    // El denominador on-page ya no incluye recursos.
    assert.equal(htmlPages.length, requested - rows.filter((r) => !isHtmlPage(r)).length);
  });

  it('cero errores de title, H1, description y canonical causados por assets', () => {
    for (const code of [
      'MISSING_TITLE',
      'MISSING_H1',
      'MISSING_DESCRIPTION',
      'MISSING_CANONICAL',
      'THIN_CONTENT',
      'IMAGES_MISSING_ALT',
    ]) {
      assert.deepEqual(
        issuesOnAssets(code).map((r) => r.page.url),
        [],
        `ningún recurso debe generar ${code}`,
      );
    }
  });

  it('antes: 54 falsos MISSING_TITLE y 54 falsos MISSING_H1 · ahora: 0', () => {
    const falsosTitle = rows.filter(
      (r) => !isHtmlPage(r) && r.issues.includes('MISSING_TITLE'),
    ).length;
    const falsosH1 = rows.filter(
      (r) => !isHtmlPage(r) && r.issues.includes('MISSING_H1'),
    ).length;
    assert.equal(falsosTitle, 0);
    assert.equal(falsosH1, 0);
  });
});

describe('las páginas HTML con errores reales siguen apareciendo', () => {
  it('sólo las páginas que de verdad no tienen description la reportan', () => {
    const missing = rows.filter((r) => r.issues.includes('MISSING_DESCRIPTION'));
    assert.equal(missing.length, FIXTURE_CONSTANTS.PAGES_WITHOUT_DESCRIPTION);
    assert.ok(missing.every(isHtmlPage));
    assert.ok(missing.every((r) => r.page.url.includes('/blog/')));
  });

  it('sólo las páginas que de verdad no tienen H1 la reportan', () => {
    const missing = rows.filter((r) => r.issues.includes('MISSING_H1'));
    assert.equal(missing.length, FIXTURE_CONSTANTS.PAGES_WITHOUT_H1);
    assert.ok(missing.every((r) => r.page.url.includes('/legal/')));
  });

  it('24. la 404 con plantilla HTML no aporta métricas on-page', () => {
    const notFound = rows.find((r) => r.page.url.endsWith('/pagina-borrada'))!;
    assert.equal(notFound.page.resourceType, 'ERROR');
    assert.ok(notFound.issues.includes('HTTP_4XX'));
    assert.ok(!notFound.issues.includes('MISSING_DESCRIPTION'));
    assert.ok(!notFound.issues.includes('MISSING_CANONICAL'));
  });
});

describe('los recursos rotos se siguen detectando', () => {
  it('17. la imagen 404 se reporta como recurso roto', () => {
    const broken = rows.find((r) => r.page.url.endsWith('/2024/03/post-0.webp'))!;
    assert.equal(broken.page.resourceType, 'ERROR');
    assert.ok(broken.issues.includes('HTTP_4XX'));
    assert.ok(!broken.issues.includes('MISSING_TITLE'));
  });

  it('la imagen rota se puede asociar a la página que la usa', () => {
    const brokenUrl = rows.find((r) => r.page.url.endsWith('/2024/03/post-0.webp'))!.page
      .url;
    const usedBy = rows.filter((r) => r.images.some((i) => i.src === brokenUrl));
    assert.ok(usedBy.length >= 1);
    assert.ok(usedBy.every(isHtmlPage));
  });

  it('23. .jpg servido como image/webp genera MIME_MISMATCH y nada más', () => {
    const row = rows.find((r) => r.page.url.endsWith('/convertida.jpg'))!;
    assert.equal(row.page.resourceType, 'IMAGE');
    assert.deepEqual(row.issues, ['MIME_MISMATCH']);
  });

  it('11/12. sin Content-Type y con octet-stream se clasifican por extensión', () => {
    assert.equal(rows.find((r) => r.page.url.endsWith('/ficha.webp'))!.page.resourceType, 'IMAGE');
    assert.equal(
      rows.find((r) => r.page.url.endsWith('/catalogo.pdf'))!.page.resourceType,
      'PDF',
    );
  });

  it('15/16. las redirecciones se clasifican como tal y no se auditan on-page', () => {
    const aHtml = rows.find((r) => r.page.url.endsWith('/servicios-antiguos'))!;
    const aImagen = rows.find((r) => r.page.url.endsWith('/foto-destacada'))!;
    assert.equal(aHtml.page.resourceType, 'REDIRECT');
    assert.equal(aImagen.page.resourceType, 'REDIRECT');
    assert.ok(aHtml.issues.includes('REDIRECT'));
    assert.ok(!aHtml.issues.includes('MISSING_TITLE'));
    assert.ok(!aImagen.issues.includes('MISSING_TITLE'));
  });
});

describe('las incidencias de alt se recalculan desde el DOM', () => {
  const elements = rows.filter(isHtmlPage).flatMap((r) => r.images);
  const summary = summarizeImageElements(elements);

  it('las 93 apariciones anteriores no se dan por buenas: se recalculan', () => {
    // El número antiguo mezclaba archivos rastreados, variantes de srcset y
    // alt="" . Aquí cada <img> del DOM cuenta una vez.
    assert.ok(summary.elements > 0);
    assert.equal(
      summary.elements,
      summary.missingAlt + summary.decorativeAlt + summary.describedAlt,
    );
  });

  it('21. una imagen responsive con srcset y <picture> cuenta una sola vez', () => {
    const home = rows.find((r) => r.page.url === `${FIXTURE_CONSTANTS.DOMAIN}/`)!;
    // logo (sin alt) + galería responsive (con alt) + separador (alt="").
    // El fondo CSS no aparece porque no es un <img>.
    assert.equal(home.images.length, 3);
    assert.equal(home.images.filter((i) => !i.hasAlt).length, 1);
  });

  it('19. alt="" nunca se cuenta como atributo alt ausente', () => {
    assert.ok(summary.decorativeAlt > 0);
    const decorativas = elements.filter((i) => i.hasAlt && !(i.alt ?? '').trim());
    assert.ok(decorativas.every((i) => i.hasAlt));
    assert.equal(
      elements.filter((i) => !i.hasAlt && (i.alt ?? '') === '').length,
      summary.missingAlt,
    );
  });

  it('22. un mismo recurso usado en varias páginas se agrega sin duplicar', () => {
    const logo = `${FIXTURE_CONSTANTS.DOMAIN}/wp-content/uploads/2023/01/logo-novemp.webp`;
    const apariciones = elements.filter((i) => i.src === logo);
    const paginas = new Set(apariciones.map((i) => i.pageKey));
    // Muchas apariciones, muchas páginas, un solo recurso.
    assert.ok(apariciones.length > 1);
    assert.equal(paginas.size, apariciones.length);
    assert.equal(new Set(apariciones.map((i) => i.src)).size, 1);
  });

  it('el denominador de "imágenes sin alt" son los <img> auditados', () => {
    assert.equal(
      summary.missingAltRatio,
      Number((summary.missingAlt / summary.elements).toFixed(4)),
    );
    // Y NO el número de URLs solicitadas ni el de archivos de imagen.
    assert.notEqual(summary.elements, rows.length);
  });

  it('las páginas afectadas se cuentan sin duplicar', () => {
    const paginas = new Set(
      elements.filter((i) => !i.hasAlt).map((i) => i.pageKey),
    );
    assert.equal(summary.pagesWithMissingAlt, paginas.size);
  });

  it('una imagen de fondo CSS nunca se reporta como sin alt', () => {
    const hero = `${FIXTURE_CONSTANTS.DOMAIN}/wp-content/uploads/2024/01/hero.webp`;
    assert.equal(elements.filter((i) => i.src === hero).length, 0);
  });
});

describe('denominadores del reporte', () => {
  it('las métricas on-page usan páginas HTML, no URLs solicitadas', () => {
    const htmlPages = rows.filter(isHtmlPage).length;
    const requested = rows.length;
    const sinDescription = countIssue('MISSING_DESCRIPTION');

    assert.ok(htmlPages < requested, 'hay recursos además de páginas');
    const ratioCorrecto = sinDescription / htmlPages;
    const ratioIncorrecto = sinDescription / requested;
    assert.ok(ratioCorrecto > ratioIncorrecto);
  });

  it('las imágenes rotas se miden sobre recursos de imagen solicitados', () => {
    const imagenes = rows.filter((r) => r.page.mediaType === 'IMAGE');
    const rotas = imagenes.filter(
      (r) => r.page.statusCode == null || r.page.statusCode >= 400,
    );
    assert.ok(imagenes.length > 0);
    assert.equal(rotas.length, 1);
  });
});
