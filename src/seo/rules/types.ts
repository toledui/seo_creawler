import { isHtmlPageResource } from '../../crawler/resource-type';

export type IssueSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Vista mínima de una página que necesitan las reglas por página. */
export type PageContext = {
  id: bigint;
  url: string;
  normalizedUrl: string;
  statusCode: number | null;
  errorType: string | null;
  contentType: string | null;
  /**
   * Clasificación del recurso. Null en crawls anteriores a este campo: en
   * ese caso se deduce del contentType.
   */
  resourceType: string | null;
  mediaType: string | null;
  mimeType: string | null;
  mimeMismatch: boolean;
  title: string | null;
  titleLength: number | null;
  metaDescription: string | null;
  metaDescriptionLength: number | null;
  h1: string | null;
  h1Count: number;
  canonical: string | null;
  metaRobots: string | null;
  wordCount: number;
  depth: number;
  indexable: boolean;
  indexabilityReason: string;
  internalInlinks: number;
  imagesCount: number;
  imagesMissingAlt: number;
  imagesDecorative: number;
  inSitemap: boolean;
  potentialOrphan: boolean;
  redirectUrl: string | null;
};

export type SeoIssue = {
  pageId: bigint | null;
  url: string | null;
  code: string;
  severity: IssueSeverity;
  title: string;
  details?: string | null;
};

/** Regla que se evalúa página por página. */
export type SeoRule = {
  code: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  run(page: PageContext): SeoIssue[];
};

/**
 * Puerta de entrada de TODA regla que mire el DOM (title, description, H1,
 * canonical, robots, Open Graph, datos estructurados, idioma, contenido
 * escaso, enlaces de la página…).
 *
 * Un recurso que no sea un documento HTML servido correctamente jamás debe
 * llegar a esas reglas: una imagen no tiene title, y decir que "le falta"
 * es un falso positivo. Los errores HTTP y de red siguen evaluándose por
 * separado, porque ésos sí afectan a cualquier recurso.
 */
export function isAuditableHtmlPage(page: PageContext): boolean {
  if (!isHtmlPageResource(page.resourceType, page.contentType)) return false;
  const status = page.statusCode;
  // Una 404 con plantilla HTML bonita no es una página válida: sus
  // metadatos no deben contaminar las métricas on-page.
  if (status == null || status < 200 || status >= 300) return false;
  return true;
}

export function issue(
  page: PageContext,
  rule: Pick<SeoRule, 'code' | 'severity' | 'title'>,
  details?: string,
): SeoIssue {
  return {
    pageId: page.id,
    url: page.normalizedUrl,
    code: rule.code,
    severity: rule.severity,
    title: rule.title,
    details: details ?? null,
  };
}
