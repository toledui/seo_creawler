/**
 * Validación de datos estructurados (JSON-LD).
 *
 * No pretende sustituir al Rich Results Test: comprueba las propiedades
 * que Google documenta como obligatorias o recomendadas para los tipos
 * más habituales, que es donde se concentran los errores reales.
 */

export type SchemaValidationIssue = {
  schemaType: string;
  severity: 'MEDIUM' | 'LOW';
  missing: string[];
  kind: 'REQUIRED' | 'RECOMMENDED';
};

type TypeSpec = {
  required: string[];
  recommended: string[];
};

/** Propiedades por tipo, según la documentación de Google Search Central. */
const SPECS: Record<string, TypeSpec> = {
  article: {
    required: ['headline'],
    recommended: ['image', 'datePublished', 'dateModified', 'author'],
  },
  blogposting: {
    required: ['headline'],
    recommended: ['image', 'datePublished', 'dateModified', 'author'],
  },
  newsarticle: {
    required: ['headline'],
    recommended: ['image', 'datePublished', 'dateModified', 'author'],
  },
  product: {
    required: ['name'],
    recommended: ['image', 'offers', 'description'],
  },
  offer: {
    required: ['price', 'priceCurrency'],
    recommended: ['availability'],
  },
  organization: {
    required: ['name'],
    recommended: ['url', 'logo'],
  },
  localbusiness: {
    required: ['name', 'address'],
    recommended: ['telephone', 'openingHours', 'geo'],
  },
  breadcrumblist: {
    required: ['itemListElement'],
    recommended: [],
  },
  faqpage: {
    required: ['mainEntity'],
    recommended: [],
  },
  person: {
    required: ['name'],
    recommended: [],
  },
  recipe: {
    required: ['name'],
    recommended: ['image', 'recipeIngredient', 'recipeInstructions'],
  },
  event: {
    required: ['name', 'startDate'],
    recommended: ['location', 'endDate'],
  },
  videoobject: {
    required: ['name', 'thumbnailUrl', 'uploadDate'],
    recommended: ['description', 'duration'],
  },
  review: {
    required: ['reviewRating'],
    recommended: ['author', 'itemReviewed'],
  },
  website: {
    required: ['name'],
    recommended: ['url'],
  },
};

/** Localiza el nodo cuyo @type coincide, incluyendo dentro de @graph. */
function findNodesOfType(root: unknown, type: string, depth = 0): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  if (!root || depth > 5) return found;

  if (Array.isArray(root)) {
    for (const node of root) found.push(...findNodesOfType(node, type, depth + 1));
    return found;
  }

  if (typeof root !== 'object') return found;
  const obj = root as Record<string, unknown>;

  const raw = obj['@type'];
  const types = (Array.isArray(raw) ? raw : [raw])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase());

  if (types.includes(type.toLowerCase())) found.push(obj);

  if (Array.isArray(obj['@graph'])) {
    found.push(...findNodesOfType(obj['@graph'], type, depth + 1));
  }

  return found;
}

function hasProperty(node: Record<string, unknown>, property: string): boolean {
  const value = node[property];
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Valida un bloque JSON-LD contra el tipo declarado.
 * Devuelve una incidencia por tipo con propiedades faltantes.
 */
export function validateSchema(
  schemaType: string | null,
  rawJson: string,
): SchemaValidationIssue[] {
  if (!schemaType) return [];

  const spec = SPECS[schemaType.toLowerCase()];
  if (!spec) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }

  const nodes = findNodesOfType(parsed, schemaType);
  if (nodes.length === 0) return [];

  const issues: SchemaValidationIssue[] = [];

  // Basta con que un nodo del tipo esté completo para no reportar.
  const missingRequired = spec.required.filter(
    (property) => !nodes.some((node) => hasProperty(node, property)),
  );
  if (missingRequired.length > 0) {
    issues.push({
      schemaType,
      severity: 'MEDIUM',
      missing: missingRequired,
      kind: 'REQUIRED',
    });
  }

  const missingRecommended = spec.recommended.filter(
    (property) => !nodes.some((node) => hasProperty(node, property)),
  );
  if (missingRecommended.length > 0) {
    issues.push({
      schemaType,
      severity: 'LOW',
      missing: missingRecommended,
      kind: 'RECOMMENDED',
    });
  }

  return issues;
}

export const VALIDATED_SCHEMA_TYPES = Object.keys(SPECS);
