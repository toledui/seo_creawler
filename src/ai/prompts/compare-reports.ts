import { z } from 'zod';
import type { AuditReport } from './executive-report';
import type { CrawlComparison } from '../../analysis/compare-crawls';

/**
 * Array que descarta los elementos inválidos en lugar de tumbar el
 * documento entero, igual que en el informe de auditoría: si la respuesta
 * se corta, se conserva todo lo que sí llegó completo.
 */
function tolerantArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((entry) => item.safeParse(entry).success)
        : value,
    z.array(item),
  );
}

export const comparisonSchema = z.object({
  summary: z.string(),
  verdict: z.enum(['MEJORA', 'ESTABLE', 'EMPEORA']).default('ESTABLE'),
  scoreDelta: z.number().default(0),
  resolved: tolerantArray(
    z.object({
      title: z.string(),
      evidence: z.string().optional().default(''),
    }),
  ).default([]),
  persisting: tolerantArray(
    z.object({
      title: z.string(),
      evidence: z.string().optional().default(''),
      whyItMatters: z.string().optional().default(''),
    }),
  ).default([]),
  regressions: tolerantArray(
    z.object({
      title: z.string(),
      evidence: z.string().optional().default(''),
      impact: z.string().optional().default(''),
    }),
  ).default([]),
  recommendationsStatus: tolerantArray(
    z.object({
      action: z.string(),
      status: z.enum(['APLICADA', 'PARCIAL', 'PENDIENTE', 'INDETERMINADA'])
        .default('INDETERMINADA'),
      evidence: z.string().optional().default(''),
    }),
  ).default([]),
  nextActions: tolerantArray(
    z.object({
      priority: z.number(),
      action: z.string(),
      rationale: z.string().optional().default(''),
    }),
  ).default([]),
});

export type ComparisonReport = z.infer<typeof comparisonSchema>;

export const COMPARE_SYSTEM_PROMPT = `Eres un consultor SEO técnico senior. Recibes DOS auditorías del mismo sitio hechas en momentos distintos, más el diff determinístico de los datos de rastreo entre ambas.

Tu trabajo es explicar qué ha cambiado realmente entre las dos fotos.

Reglas estrictas:
1. No inventes datos. Usa sólo las cifras de las dos auditorías y del diff.
2. Distingue lo que se ARREGLÓ, lo que SIGUE IGUAL y lo que EMPEORÓ.
3. Para cada recomendación de la auditoría anterior, di si se aplicó, se aplicó a medias o sigue pendiente, y justifícalo con datos del diff. Si los datos no permiten saberlo, marca INDETERMINADA en lugar de suponer.
4. Cita cifras concretas (antes → después) en cada punto.
5. El veredicto global sale del balance: MEJORA, ESTABLE o EMPEORA.
6. Escribe en español.
7. Responde EXCLUSIVAMENTE con un objeto JSON válido, sin markdown ni texto adicional.

Estructura JSON exigida:
{
  "summary": "3-5 frases sobre la evolución",
  "verdict": "MEJORA|ESTABLE|EMPEORA",
  "scoreDelta": número (score nuevo menos score anterior),
  "resolved": [{"title","evidence"}],
  "persisting": [{"title","evidence","whyItMatters"}],
  "regressions": [{"title","evidence","impact"}],
  "recommendationsStatus": [{"action","status":"APLICADA|PARCIAL|PENDIENTE|INDETERMINADA","evidence"}],
  "nextActions": [{"priority":1,"action","rationale"}]
}

Limita la extensión para que el JSON quepa entero: como mucho 8 elementos por lista y frases de una o dos líneas.`;

export type CompareContext = {
  project: { name: string; domain: string };
  before: {
    reportId: string;
    createdAt: string;
    crawlId: string;
    crawledUrls: number;
    report: AuditReport;
  };
  after: {
    reportId: string;
    createdAt: string;
    crawlId: string;
    crawledUrls: number;
    report: AuditReport;
  };
  /** Diff determinístico del rastreo; null si ambos informes son del mismo crawl. */
  crawlDiff: Pick<
    CrawlComparison,
    'metrics' | 'issueDeltas' | 'counts'
  > | null;
  sameCrawl: boolean;
};

export function buildComparePrompt(context: CompareContext): string {
  const lines = [
    `Sitio: ${context.project.name} (${context.project.domain})`,
    '',
    `Auditoría ANTERIOR: ${context.before.createdAt} · crawl ${context.before.crawlId} · ${context.before.crawledUrls} URLs`,
    `Auditoría NUEVA: ${context.after.createdAt} · crawl ${context.after.crawlId} · ${context.after.crawledUrls} URLs`,
    '',
  ];

  if (context.sameCrawl) {
    lines.push(
      'AVISO: las dos auditorías se generaron sobre EL MISMO rastreo, así que los datos técnicos son idénticos y no hay diff. Compara únicamente el criterio y las conclusiones de ambos informes, y dilo explícitamente en el resumen: no ha pasado tiempo ni ha cambiado el sitio.',
      '',
    );
  }

  lines.push(
    'AUDITORÍA ANTERIOR (JSON):',
    JSON.stringify(context.before.report),
    '',
    'AUDITORÍA NUEVA (JSON):',
    JSON.stringify(context.after.report),
    '',
  );

  if (context.crawlDiff) {
    lines.push(
      'DIFF DETERMINÍSTICO DEL RASTREO (JSON):',
      JSON.stringify(context.crawlDiff),
      '',
    );
  }

  lines.push(
    'Genera la comparación siguiendo exactamente el esquema JSON indicado.',
  );

  return lines.join('\n');
}
