export type IssueSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Vista mínima de una página que necesitan las reglas por página. */
export type PageContext = {
  id: bigint;
  url: string;
  normalizedUrl: string;
  statusCode: number | null;
  errorType: string | null;
  contentType: string | null;
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
