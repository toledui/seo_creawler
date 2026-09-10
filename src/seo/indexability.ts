export type IndexabilityReason =
  | 'INDEXABLE'
  | 'NOINDEX'
  | 'BLOCKED_ROBOTS'
  | 'REDIRECT'
  | 'CLIENT_ERROR'
  | 'SERVER_ERROR'
  | 'CANONICALIZED'
  | 'UNSUPPORTED_CONTENT'
  | 'FETCH_ERROR';

export type IndexabilityInput = {
  statusCode: number | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
  canonical: string | null;
  normalizedUrl: string;
  canonicalNormalized: string | null;
  blockedByRobots: boolean;
  isHtml: boolean;
  hasError: boolean;
};

export type IndexabilityResult = {
  indexable: boolean;
  reason: IndexabilityReason;
};

function hasNoindex(value: string | null): boolean {
  if (!value) return false;
  return /(^|[,\s])(noindex|none)($|[,\s])/i.test(value);
}

/**
 * Función central de indexabilidad (sección 19 del plan).
 * El orden de evaluación importa: gana la razón más "dura".
 */
export function evaluateIndexability(
  input: IndexabilityInput,
): IndexabilityResult {
  if (input.blockedByRobots) {
    return { indexable: false, reason: 'BLOCKED_ROBOTS' };
  }
  if (input.hasError || input.statusCode == null) {
    return { indexable: false, reason: 'FETCH_ERROR' };
  }
  if (input.statusCode >= 500) {
    return { indexable: false, reason: 'SERVER_ERROR' };
  }
  if (input.statusCode >= 400) {
    return { indexable: false, reason: 'CLIENT_ERROR' };
  }
  if (input.statusCode >= 300) {
    return { indexable: false, reason: 'REDIRECT' };
  }
  if (!input.isHtml) {
    return { indexable: false, reason: 'UNSUPPORTED_CONTENT' };
  }
  if (hasNoindex(input.metaRobots) || hasNoindex(input.xRobotsTag)) {
    return { indexable: false, reason: 'NOINDEX' };
  }
  if (
    input.canonicalNormalized &&
    input.canonicalNormalized !== input.normalizedUrl
  ) {
    return { indexable: false, reason: 'CANONICALIZED' };
  }
  return { indexable: true, reason: 'INDEXABLE' };
}

export function isNofollowRobots(value: string | null): boolean {
  if (!value) return false;
  return /(^|[,\s])(nofollow|none)($|[,\s])/i.test(value);
}
