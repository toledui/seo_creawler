import type { ParsedPage } from '../crawler/types';

/**
 * Señales GEO por página (secciones 35–36 del plan).
 * Todas son verificables y explicables: nada aquí lo decide la IA.
 */
export type PageGeoSignals = {
  hasStructuredData: boolean;
  schemaTypes: string[];
  hasAuthor: boolean;
  hasPublishedDate: boolean;
  hasModifiedDate: boolean;
  hasBreadcrumbs: boolean;
  hasFaq: boolean;
  headingStructureOk: boolean;
  hasServerRenderedContent: boolean;
  externalCitations: number;
  textRatio: number;
};

export function geoSignalsForPage(parsed: ParsedPage): PageGeoSignals {
  const types = [
    ...new Set(
      parsed.schemas
        .map((s) => s.schemaType)
        .filter((t): t is string => Boolean(t)),
    ),
  ];
  const lower = types.map((t) => t.toLowerCase());

  // Estructura de headings correcta: exactamente un H1 y al menos un H2
  // cuando el contenido tiene cuerpo suficiente.
  const headingStructureOk =
    parsed.h1Count === 1 && (parsed.wordCount < 300 || parsed.h2Count >= 1);

  return {
    hasStructuredData: parsed.schemas.length > 0,
    schemaTypes: types.slice(0, 20),
    hasAuthor: parsed.hasAuthor,
    hasPublishedDate: Boolean(parsed.publishedDate),
    hasModifiedDate: Boolean(parsed.modifiedDate),
    hasBreadcrumbs: lower.includes('breadcrumblist'),
    hasFaq: lower.includes('faqpage'),
    headingStructureOk,
    hasServerRenderedContent: parsed.wordCount >= 150,
    externalCitations: parsed.externalCitations,
    textRatio: parsed.textRatio,
  };
}

export type GeoCategoryScore = {
  key: string;
  label: string;
  score: number;
  max: number;
  detail: string;
};

export type GeoReadiness = {
  score: number;
  categories: GeoCategoryScore[];
};

type GeoAggregateInput = {
  totalIndexable: number;
  withStructuredData: number;
  withOrganization: number;
  withBreadcrumbs: number;
  withAuthor: number;
  withDates: number;
  withGoodHeadings: number;
  withServerContent: number;
  withFaq: number;
  withCitations: number;
  hasAboutPage: boolean;
  hasContactPage: boolean;
};

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/**
 * Score GEO del crawl completo. Cada categoría es explicable por separado,
 * tal y como pide la sección 36 ("generar score únicamente si cada
 * componente es explicable").
 */
export function computeGeoReadiness(input: GeoAggregateInput): GeoReadiness {
  const total = input.totalIndexable;

  const categories: GeoCategoryScore[] = [
    {
      key: 'entity_clarity',
      label: 'Claridad de entidad',
      score: input.withOrganization > 0 ? 15 : 0,
      max: 15,
      detail:
        input.withOrganization > 0
          ? `Organization/LocalBusiness schema presente en ${input.withOrganization} página(s)`
          : 'No se detectó schema Organization ni LocalBusiness',
    },
    {
      key: 'structured_data',
      label: 'Datos estructurados',
      score: Math.round((pct(input.withStructuredData, total) / 100) * 20),
      max: 20,
      detail: `${pct(input.withStructuredData, total)}% de las páginas indexables tienen JSON-LD`,
    },
    {
      key: 'content_structure',
      label: 'Estructura del contenido',
      score: Math.round((pct(input.withGoodHeadings, total) / 100) * 15),
      max: 15,
      detail: `${pct(input.withGoodHeadings, total)}% con jerarquía de headings correcta`,
    },
    {
      key: 'machine_readability',
      label: 'Legibilidad para máquinas',
      score: Math.round((pct(input.withServerContent, total) / 100) * 15),
      max: 15,
      detail: `${pct(input.withServerContent, total)}% con contenido servido en HTML (>=150 palabras)`,
    },
    {
      key: 'author_transparency',
      label: 'Transparencia de autoría',
      score: Math.round((pct(input.withAuthor, total) / 100) * 10),
      max: 10,
      detail: `${pct(input.withAuthor, total)}% de las páginas identifican un autor`,
    },
    {
      key: 'source_transparency',
      label: 'Transparencia de fuentes',
      score:
        (input.hasAboutPage ? 5 : 0) +
        (input.hasContactPage ? 5 : 0),
      max: 10,
      detail: [
        input.hasAboutPage ? 'About detectada' : 'Sin página About',
        input.hasContactPage ? 'Contact detectada' : 'Sin página Contact',
      ].join(' · '),
    },
    {
      key: 'answerability',
      label: 'Capacidad de respuesta',
      score: Math.min(
        10,
        Math.round((pct(input.withDates, total) / 100) * 5) +
          (input.withFaq > 0 ? 5 : 0),
      ),
      max: 10,
      detail: `${pct(input.withDates, total)}% con fechas; ${input.withFaq} página(s) con FAQPage`,
    },
    {
      key: 'internal_semantic_linking',
      label: 'Enlazado semántico interno',
      score: input.withBreadcrumbs > 0 ? 5 : 0,
      max: 5,
      detail:
        input.withBreadcrumbs > 0
          ? `BreadcrumbList en ${input.withBreadcrumbs} página(s)`
          : 'Sin BreadcrumbList detectado',
    },
  ];

  const score = categories.reduce((sum, c) => sum + c.score, 0);
  return { score, categories };
}
