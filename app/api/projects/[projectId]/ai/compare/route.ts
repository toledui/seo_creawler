import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { getUserAiConfig } from '@/lib/settings';
import {
  AiNotConfiguredError,
  chat,
  extractJson,
} from '@/src/ai/deepseek-client';
import {
  buildComparePrompt,
  comparisonSchema,
  COMPARE_SYSTEM_PROMPT,
  type CompareContext,
} from '@/src/ai/prompts/compare-reports';
import type { AuditReport } from '@/src/ai/prompts/executive-report';
import { compareCrawls } from '@/src/analysis/compare-crawls';

type Params = { params: Promise<{ projectId: string }> };

export const maxDuration = 300;

const MAX_OUTPUT_TOKENS = 8000;

const schema = z.object({
  baseReportId: z.string().min(1),
  targetReportId: z.string().min(1),
});

/** Comparaciones ya generadas en el proyecto. */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectOwner(projectId, user.id);

    const comparisons = await prisma.aiReport.findMany({
      where: { crawl: { projectId }, type: 'comparison', error: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const ai = await getUserAiConfig(user.id);
    return ok({ comparisons, enabled: ai.configured });
  });
}

/**
 * Compara dos auditorías con el mismo modelo que las generó.
 *
 * Al LLM no se le manda el crawl entero: recibe los dos informes ya
 * estructurados más el diff determinístico de los rastreos, de modo que
 * la comparación se apoya en cifras reales y no en su memoria.
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    const project = await assertProjectWrite(projectId, user.id);

    const ai = await getUserAiConfig(user.id);
    if (!ai.configured) {
      return fail(
        'Tu cuenta no tiene clave de IA. Configúrala en Ajustes → Inteligencia artificial.',
        400,
      );
    }

    const body = schema.parse(await request.json());

    if (body.baseReportId === body.targetReportId) {
      return fail('Elige dos informes distintos', 422);
    }

    const [base, target] = await Promise.all([
      prisma.aiReport.findFirst({
        where: { id: body.baseReportId, crawl: { projectId } },
        include: { crawl: { select: { id: true, crawledUrls: true } } },
      }),
      prisma.aiReport.findFirst({
        where: { id: body.targetReportId, crawl: { projectId } },
        include: { crawl: { select: { id: true, crawledUrls: true } } },
      }),
    ]);

    if (!base || !target) return fail('Informe no encontrado', 404);
    if (!base.output || !target.output) {
      return fail('Alguno de los informes no tiene contenido que comparar', 409);
    }

    // El más antiguo hace de referencia, pase el orden que pase el cliente.
    const [before, after] =
      base.createdAt <= target.createdAt ? [base, target] : [target, base];

    const sameCrawl = before.crawlId === after.crawlId;

    let crawlDiff: CompareContext['crawlDiff'] = null;
    if (!sameCrawl) {
      const diff = await compareCrawls(before.crawlId, after.crawlId);
      crawlDiff = {
        metrics: diff.metrics,
        issueDeltas: diff.issueDeltas.slice(0, 25),
        counts: diff.counts,
      };
    }

    const context: CompareContext = {
      project: { name: project.name, domain: project.domain },
      before: {
        reportId: before.id,
        createdAt: before.createdAt.toISOString(),
        crawlId: before.crawlId,
        crawledUrls: before.crawl.crawledUrls,
        report: before.output as unknown as AuditReport,
      },
      after: {
        reportId: after.id,
        createdAt: after.createdAt.toISOString(),
        crawlId: after.crawlId,
        crawledUrls: after.crawl.crawledUrls,
        report: after.output as unknown as AuditReport,
      },
      crawlDiff,
      sameCrawl,
    };

    let lastError = '';
    let lastModel = ai.model;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const brevity =
          attempt === 0
            ? ''
            : '\n\nIMPORTANTE: la respuesta anterior se cortó. Sé mucho más conciso: máximo 5 elementos por lista y frases breves. El JSON debe quedar completo.';

        const response = await chat({
          config: ai,
          messages: [
            { role: 'system', content: COMPARE_SYSTEM_PROMPT },
            { role: 'user', content: buildComparePrompt(context) + brevity },
          ],
          jsonMode: true,
          temperature: 0.2,
          maxTokens: MAX_OUTPUT_TOKENS,
        });

        lastModel = response.model;
        if (!response.content) throw new Error('Respuesta vacía de la IA');

        const parsed = comparisonSchema.parse(extractJson(response.content));

        const saved = await prisma.aiReport.create({
          data: {
            // La comparación se cuelga del crawl más reciente de los dos.
            crawlId: after.crawlId,
            model: response.model,
            type: 'comparison',
            input: {
              baseReportId: before.id,
              targetReportId: after.id,
              baseCreatedAt: before.createdAt.toISOString(),
              targetCreatedAt: after.createdAt.toISOString(),
              sameCrawl,
            } as unknown as Prisma.InputJsonValue,
            output: parsed as unknown as Prisma.InputJsonValue,
          },
        });

        return ok({ comparison: saved });
      } catch (err) {
        if (err instanceof AiNotConfiguredError) return fail(err.message, 400);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    await prisma.aiReport.create({
      data: {
        crawlId: after.crawlId,
        model: lastModel,
        type: 'comparison',
        input: {
          baseReportId: before.id,
          targetReportId: after.id,
        } as unknown as Prisma.InputJsonValue,
        error: lastError.slice(0, 2000),
      },
    });

    return fail(`La comparación falló: ${lastError}`, 502);
  });
}
