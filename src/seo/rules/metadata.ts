import { issue, type SeoRule } from './types';

const TITLE_MAX = 60;
const TITLE_MIN = 20;
const DESCRIPTION_MAX = 160;
const DESCRIPTION_MIN = 70;

/** Solo evaluamos metadatos en páginas HTML que respondieron 200. */
function isContentPage(status: number | null): boolean {
  return status != null && status >= 200 && status < 300;
}

export const missingTitleRule: SeoRule = {
  code: 'MISSING_TITLE',
  severity: 'MEDIUM',
  title: 'Title ausente',
  description: 'La página no tiene etiqueta title o está vacía.',
  run(page) {
    if (!isContentPage(page.statusCode)) return [];
    if (page.title && page.title.trim()) return [];
    return [issue(page, missingTitleRule)];
  },
};

export const titleTooLongRule: SeoRule = {
  code: 'TITLE_TOO_LONG',
  severity: 'LOW',
  title: 'Title demasiado largo',
  description: `El title supera ${TITLE_MAX} caracteres y puede truncarse en SERP.`,
  run(page) {
    if (!isContentPage(page.statusCode)) return [];
    const len = page.titleLength ?? 0;
    if (len <= TITLE_MAX) return [];
    return [issue(page, titleTooLongRule, `${len} caracteres`)];
  },
};

export const titleTooShortRule: SeoRule = {
  code: 'TITLE_TOO_SHORT',
  severity: 'LOW',
  title: 'Title demasiado corto',
  description: `El title tiene menos de ${TITLE_MIN} caracteres.`,
  run(page) {
    if (!isContentPage(page.statusCode)) return [];
    const len = page.titleLength ?? 0;
    if (len === 0 || len >= TITLE_MIN) return [];
    return [issue(page, titleTooShortRule, `${len} caracteres`)];
  },
};

export const missingDescriptionRule: SeoRule = {
  code: 'MISSING_DESCRIPTION',
  severity: 'MEDIUM',
  title: 'Meta description ausente',
  description: 'La página no declara meta description.',
  run(page) {
    if (!isContentPage(page.statusCode)) return [];
    if (page.metaDescription && page.metaDescription.trim()) return [];
    return [issue(page, missingDescriptionRule)];
  },
};

export const descriptionTooLongRule: SeoRule = {
  code: 'DESCRIPTION_TOO_LONG',
  severity: 'LOW',
  title: 'Meta description demasiado larga',
  description: `La descripción supera ${DESCRIPTION_MAX} caracteres.`,
  run(page) {
    if (!isContentPage(page.statusCode)) return [];
    const len = page.metaDescriptionLength ?? 0;
    if (len <= DESCRIPTION_MAX) return [];
    return [issue(page, descriptionTooLongRule, `${len} caracteres`)];
  },
};

export const descriptionTooShortRule: SeoRule = {
  code: 'DESCRIPTION_TOO_SHORT',
  severity: 'LOW',
  title: 'Meta description demasiado corta',
  description: `La descripción tiene menos de ${DESCRIPTION_MIN} caracteres.`,
  run(page) {
    if (!isContentPage(page.statusCode)) return [];
    const len = page.metaDescriptionLength ?? 0;
    if (len === 0 || len >= DESCRIPTION_MIN) return [];
    return [issue(page, descriptionTooShortRule, `${len} caracteres`)];
  },
};

export const missingH1Rule: SeoRule = {
  code: 'MISSING_H1',
  severity: 'MEDIUM',
  title: 'H1 ausente',
  description: 'La página no tiene ningún H1.',
  run(page) {
    if (!isContentPage(page.statusCode)) return [];
    if (page.h1Count > 0) return [];
    return [issue(page, missingH1Rule)];
  },
};

export const multipleH1Rule: SeoRule = {
  code: 'MULTIPLE_H1',
  severity: 'MEDIUM',
  title: 'Múltiples H1',
  description: 'La página declara más de un H1.',
  run(page) {
    if (!isContentPage(page.statusCode)) return [];
    if (page.h1Count <= 1) return [];
    return [issue(page, multipleH1Rule, `${page.h1Count} etiquetas H1`)];
  },
};
