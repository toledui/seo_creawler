import { z } from 'zod';
import type { AuditContext } from '../context-builder';

/**
 * Array que descarta los elementos que no validan en lugar de invalidar
 * todo el documento.
 *
 * Cuando la respuesta del modelo se corta, el último elemento queda a
 * medias; con esto el informe conserva todo lo anterior en vez de
 * perderse entero. También protege de un item mal formado suelto.
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

export const auditSchema = z.object({
  summary: z.string(),
  score: z.number().min(0).max(100),
  seoHealth: z.string().optional().default(''),
  criticalIssues: tolerantArray(
    z.object({
      title: z.string(),
      impact: z.string(),
      evidence: z.string().optional().default(''),
      affectedUrls: z.array(z.string()).optional().default([]),
    }),
  ).default([]),
  highPriorityIssues: tolerantArray(
    z.object({
      title: z.string(),
      impact: z.string(),
      evidence: z.string().optional().default(''),
    }),
  ).default([]),
  internalLinking: z
    .object({
      diagnosis: z.string(),
      wastedPageRank: z.string().optional().default(''),
      pagesToBoost: z.array(z.string()).optional().default([]),
      recommendations: z.array(z.string()).optional().default([]),
    })
    .optional(),
  technicalSeo: z.object({ findings: z.array(z.string()) }).optional(),
  contentFindings: z.object({ findings: z.array(z.string()) }).optional(),
  geo: z
    .object({
      readiness: z.string(),
      gaps: z.array(z.string()).optional().default([]),
      recommendations: z.array(z.string()).optional().default([]),
    })
    .optional(),
  recommendations: tolerantArray(
    z.object({
      priority: z.number(),
      action: z.string(),
      rationale: z.string().optional().default(''),
      expectedImpact: z.string().optional().default(''),
      effort: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional().default('MEDIUM'),
    }),
  ).default([]),
  implementationOrder: z.array(z.string()).default([]),
});

export type AuditReport = z.infer<typeof auditSchema>;

export const AUDIT_SYSTEM_PROMPT = `Eres un consultor SEO técnico senior especializado en arquitectura web, enlazado interno y GEO (Generative Engine Optimization).

Recibirás un RESUMEN ESTRUCTURADO de un rastreo real de un sitio web. No tienes acceso al HTML: trabaja únicamente con los datos que se te entregan.

Reglas estrictas:
1. No inventes datos. Si un número no está en el contexto, no lo cites.
2. Cita siempre cifras concretas del contexto para justificar cada hallazgo.
3. Prioriza por impacto real en indexación, rastreo y distribución de PageRank interno.
4. Sé específico y accionable: nada de consejos genéricos tipo "mejora tu contenido".
5. Escribe en español.
6. Responde EXCLUSIVAMENTE con un objeto JSON válido, sin markdown ni texto adicional.

Estructura JSON exigida:
{
  "summary": "resumen ejecutivo de 3-6 frases",
  "score": 0-100,
  "seoHealth": "valoración breve del estado técnico",
  "criticalIssues": [{"title","impact","evidence","affectedUrls":[]}],
  "highPriorityIssues": [{"title","impact","evidence"}],
  "internalLinking": {"diagnosis","wastedPageRank","pagesToBoost":[],"recommendations":[]},
  "technicalSeo": {"findings":[]},
  "contentFindings": {"findings":[]},
  "geo": {"readiness","gaps":[],"recommendations":[]},
  "recommendations": [{"priority":1,"action","rationale","expectedImpact","effort":"LOW|MEDIUM|HIGH"}],
  "implementationOrder": ["paso 1","paso 2"]
}

Incluye entre 8 y 12 recomendaciones ordenadas por prioridad (1 = más urgente).

Limita la extensión para que el JSON quepa entero: como mucho 6 issues críticos,
8 de prioridad alta, 10 URLs por lista y frases de una o dos líneas. Es
preferible un informe completo y breve que uno extenso que se corte.`;

export function buildAuditUserPrompt(context: AuditContext): string {
  return [
    `Sitio: ${context.project.name} (${context.project.domain})`,
    `URL de inicio del crawl: ${context.crawl.startUrl}`,
    '',
    'DATOS DEL CRAWL (JSON):',
    // Sin indentar: el mismo dato ocupa bastantes menos tokens y deja más
    // presupuesto para la respuesta.
    JSON.stringify(context),
    '',
    'Genera la auditoría SEO + GEO siguiendo exactamente el esquema JSON indicado.',
  ].join('\n');
}
