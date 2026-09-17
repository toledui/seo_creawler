import { isAuditableHtmlPage, issue, type SeoRule } from './types';

export const MAX_RECOMMENDED_DEPTH = 4;
const THIN_CONTENT_WORDS = 200;

export const redirectRule: SeoRule = {
  code: 'REDIRECT',
  severity: 'MEDIUM',
  title: 'Redirección interna',
  description: 'La URL interna responde con una redirección 3xx.',
  run(page) {
    const status = page.statusCode ?? 0;
    if (status < 300 || status >= 400) return [];
    return [
      issue(page, redirectRule, `Status ${status} → ${page.redirectUrl ?? 'destino desconocido'}`),
    ];
  },
};

export const redirectLoopRule: SeoRule = {
  code: 'REDIRECT_LOOP',
  severity: 'CRITICAL',
  title: 'Bucle de redirecciones',
  description: 'La cadena de redirecciones nunca termina o excede el límite.',
  run(page) {
    if (page.errorType !== 'TOO_MANY_REDIRECTS') return [];
    return [issue(page, redirectLoopRule, page.redirectUrl ?? undefined)];
  },
};

export const canonicalizedRule: SeoRule = {
  code: 'CANONICALIZED',
  severity: 'MEDIUM',
  title: 'URL canonicalizada a otra',
  description: 'El canonical apunta a una URL distinta, la página no se indexará.',
  run(page) {
    if (!isAuditableHtmlPage(page)) return [];
    if (page.indexabilityReason !== 'CANONICALIZED') return [];
    return [issue(page, canonicalizedRule, `canonical → ${page.canonical}`)];
  },
};

export const missingCanonicalRule: SeoRule = {
  code: 'MISSING_CANONICAL',
  severity: 'LOW',
  title: 'Canonical ausente',
  description: 'La página indexable no declara link rel=canonical.',
  run(page) {
    if (!isAuditableHtmlPage(page)) return [];
    if (page.canonical) return [];
    return [issue(page, missingCanonicalRule)];
  },
};

export const noindexRule: SeoRule = {
  code: 'NOINDEX',
  severity: 'HIGH',
  title: 'Página con noindex',
  description: 'meta robots o X-Robots-Tag marcan la página como noindex.',
  run(page) {
    if (!isAuditableHtmlPage(page)) return [];
    if (page.indexabilityReason !== 'NOINDEX') return [];
    return [issue(page, noindexRule, page.metaRobots ?? 'X-Robots-Tag')];
  },
};

export const blockedByRobotsRule: SeoRule = {
  code: 'BLOCKED_ROBOTS',
  severity: 'HIGH',
  title: 'Bloqueada por robots.txt',
  description: 'robots.txt impide el rastreo de esta URL.',
  run(page) {
    if (page.indexabilityReason !== 'BLOCKED_ROBOTS') return [];
    return [issue(page, blockedByRobotsRule)];
  },
};

export const deepPageRule: SeoRule = {
  code: 'DEEP_PAGE',
  severity: 'MEDIUM',
  title: `Profundidad mayor a ${MAX_RECOMMENDED_DEPTH}`,
  description: 'La página está demasiado lejos de la home en clics.',
  run(page) {
    if (!isAuditableHtmlPage(page)) return [];
    if (page.depth <= MAX_RECOMMENDED_DEPTH) return [];
    if (!page.indexable) return [];
    return [issue(page, deepPageRule, `Profundidad ${page.depth}`)];
  },
};

export const thinContentRule: SeoRule = {
  code: 'THIN_CONTENT',
  severity: 'LOW',
  title: 'Contenido escaso',
  description: `Menos de ${THIN_CONTENT_WORDS} palabras de texto visible.`,
  run(page) {
    if (!isAuditableHtmlPage(page)) return [];
    if (!page.indexable) return [];
    if (page.wordCount >= THIN_CONTENT_WORDS) return [];
    return [issue(page, thinContentRule, `${page.wordCount} palabras`)];
  },
};

export const imagesMissingAltRule: SeoRule = {
  code: 'IMAGES_MISSING_ALT',
  severity: 'LOW',
  title: 'Imágenes sin atributo alt',
  description: 'La página contiene imágenes sin texto alternativo.',
  run(page) {
    // Las incidencias de alt nacen SIEMPRE de los <img> del DOM de una
    // página HTML, nunca de pedir la URL del archivo de imagen.
    if (!isAuditableHtmlPage(page)) return [];
    if (page.imagesMissingAlt <= 0) return [];
    return [
      issue(
        page,
        imagesMissingAltRule,
        `${page.imagesMissingAlt} de ${page.imagesCount} imágenes sin atributo alt`,
      ),
    ];
  },
};

/**
 * `alt=""` es la forma correcta de declarar una imagen decorativa, así que
 * se informa sin penalizar. Nunca se mezcla con IMAGES_MISSING_ALT.
 */
export const imagesDecorativeAltRule: SeoRule = {
  code: 'IMAGES_DECORATIVE_ALT',
  severity: 'INFO',
  title: 'Imágenes decorativas (alt vacío)',
  description:
    'La página declara imágenes con alt="". Es válido para decoración; revisa que ninguna aporte contenido.',
  run(page) {
    if (!isAuditableHtmlPage(page)) return [];
    if (page.imagesDecorative <= 0) return [];
    return [
      issue(
        page,
        imagesDecorativeAltRule,
        `${page.imagesDecorative} de ${page.imagesCount} imágenes con alt=""`,
      ),
    ];
  },
};

export const lowInlinksRule: SeoRule = {
  code: 'LOW_INLINKS',
  severity: 'MEDIUM',
  title: 'Pocos enlaces internos entrantes',
  description: 'La página indexable recibe menos de 2 enlaces internos.',
  run(page) {
    if (!isAuditableHtmlPage(page)) return [];
    if (!page.indexable) return [];
    if (page.depth === 0) return [];
    if (page.internalInlinks >= 2) return [];
    return [issue(page, lowInlinksRule, `${page.internalInlinks} inlinks`)];
  },
};

export const orphanRule: SeoRule = {
  code: 'POTENTIAL_ORPHAN',
  severity: 'HIGH',
  title: 'Página huérfana potencial',
  description: 'Aparece en el sitemap pero no recibe ningún enlace interno.',
  run(page) {
    if (!isAuditableHtmlPage(page)) return [];
    if (!page.potentialOrphan) return [];
    return [issue(page, orphanRule, 'En sitemap, sin inlinks internos')];
  },
};
