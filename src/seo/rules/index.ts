import {
  clientErrorRule,
  fetchErrorRule,
  serverErrorRule,
} from './broken-page';
import {
  descriptionTooLongRule,
  descriptionTooShortRule,
  missingDescriptionRule,
  missingH1Rule,
  missingTitleRule,
  multipleH1Rule,
  titleTooLongRule,
  titleTooShortRule,
} from './metadata';
import { assetRules } from './assets';
import {
  blockedByRobotsRule,
  canonicalizedRule,
  deepPageRule,
  imagesDecorativeAltRule,
  imagesMissingAltRule,
  lowInlinksRule,
  missingCanonicalRule,
  noindexRule,
  orphanRule,
  redirectLoopRule,
  redirectRule,
  thinContentRule,
} from './technical';
import { HREFLANG_RULES } from '../hreflang-validation';
import type { SeoRule } from './types';

/** Todas las reglas por página del MVP (sección 18 del plan). */
export const pageRules: SeoRule[] = [
  serverErrorRule,
  clientErrorRule,
  fetchErrorRule,
  redirectLoopRule,
  redirectRule,
  noindexRule,
  blockedByRobotsRule,
  canonicalizedRule,
  missingCanonicalRule,
  orphanRule,
  missingTitleRule,
  titleTooLongRule,
  titleTooShortRule,
  missingDescriptionRule,
  descriptionTooLongRule,
  descriptionTooShortRule,
  missingH1Rule,
  multipleH1Rule,
  deepPageRule,
  lowInlinksRule,
  thinContentRule,
  imagesMissingAltRule,
  imagesDecorativeAltRule,
  ...assetRules,
];

/** Reglas agregadas que necesitan mirar todo el crawl. */
export const CRAWL_RULE_CATALOG = [
  {
    code: 'DUPLICATE_TITLE',
    severity: 'MEDIUM' as const,
    title: 'Title duplicado',
    description: 'Varias páginas indexables comparten el mismo title.',
  },
  {
    code: 'DUPLICATE_DESCRIPTION',
    severity: 'MEDIUM' as const,
    title: 'Meta description duplicada',
    description: 'Varias páginas indexables comparten la misma descripción.',
  },
  {
    code: 'DUPLICATE_CONTENT',
    severity: 'MEDIUM' as const,
    title: 'Contenido duplicado',
    description: 'Varias páginas indexables tienen exactamente el mismo texto.',
  },
  {
    code: 'BROKEN_INTERNAL_LINK',
    severity: 'HIGH' as const,
    title: 'Enlace interno roto',
    description: 'Un enlace interno apunta a una URL que responde 4xx o 5xx.',
  },
  {
    code: 'BROKEN_IMAGE',
    severity: 'HIGH' as const,
    title: 'Imagen rota en la página',
    description:
      'Una página HTML usa un <img> cuyo archivo responde 4xx/5xx o no se puede descargar.',
  },
  {
    code: 'NEAR_DUPLICATE_CONTENT',
    severity: 'MEDIUM' as const,
    title: 'Contenido casi duplicado',
    description:
      'Dos páginas comparten prácticamente el mismo texto (detectado por SimHash).',
  },
  {
    code: 'SCHEMA_INVALID_JSON',
    severity: 'MEDIUM' as const,
    title: 'JSON-LD inválido',
    description: 'El bloque application/ld+json no es JSON parseable.',
  },
  {
    code: 'SCHEMA_MISSING_REQUIRED',
    severity: 'MEDIUM' as const,
    title: 'Schema sin propiedades obligatorias',
    description:
      'El tipo declarado carece de propiedades que Google marca como obligatorias.',
  },
  {
    code: 'SCHEMA_MISSING_RECOMMENDED',
    severity: 'LOW' as const,
    title: 'Schema sin propiedades recomendadas',
    description:
      'Faltan propiedades recomendadas que mejoran la elegibilidad para resultados enriquecidos.',
  },
  ...HREFLANG_RULES,
];

export const RULE_CATALOG = [
  ...pageRules.map((r) => ({
    code: r.code,
    severity: r.severity,
    title: r.title,
    description: r.description,
  })),
  ...CRAWL_RULE_CATALOG,
];

export const ruleByCode = new Map(RULE_CATALOG.map((r) => [r.code, r]));

export type { SeoRule } from './types';
