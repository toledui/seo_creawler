import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertCrawlOwner, assertCrawlWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { getUserAiConfig } from '@/lib/settings';
import { maybeEmailAiReport } from '@/src/ai/notify';
import { buildAuditContext } from '@/src/ai/context-builder';
import {
  AiNotConfiguredError,
  chat,
  extractJson,
} from '@/src/ai/deepseek-client';
import {
  AUDIT_SYSTEM_PROMPT,
  auditSchema,
  buildAuditUserPrompt,
} from '@/src/ai/prompts/executive-report';

type Params = { params: Promise<{ crawlId: string }> };

export const maxDuration = 300;

/** Tope de salida de deepseek-chat. */
const MAX_OUTPUT_TOKENS = 8000;

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    await assertCrawlOwner(crawlId, user.id);

    const reports = await prisma.aiReport.findMany({
      where: { crawlId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const ai = await getUserAiConfig(user.id);
    return ok({ reports, enabled: ai.configured });
  });
}

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    const crawl = await assertCrawlWrite(crawlId, user.id);

    const ai = await getUserAiConfig(user.id);
    if (!ai.configured) {
      return fail(
        'Tu cuenta no tiene clave de IA. Configúrala en Ajustes → Inteligencia artificial.',
        400,
      );
    }

    if (crawl.crawledUrls === 0) {
      return fail('El crawl todavía no tiene páginas rastreadas', 409);
    }

    const context = await buildAuditContext(crawlId);

    let lastError = '';
    let lastModel = ai.model;

    // Dos intentos: si el primero se corta o no valida, repetimos pidiendo
    // una respuesta más compacta en lugar de perder el informe.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const brevity =
          attempt === 0
            ? ''
            : '\n\nIMPORTANTE: la respuesta anterior se cortó por longitud. Sé mucho más conciso: máximo 5 issues críticos, 5 de prioridad alta y 8 recomendaciones, con frases breves. El JSON debe quedar completo y cerrado.';

        const response = await chat({
          config: ai,
          messages: [
            { role: 'system', content: AUDIT_SYSTEM_PROMPT },
            { role: 'user', content: buildAuditUserPrompt(context) + brevity },
          ],
          jsonMode: true,
          temperature: 0.2,
          maxTokens: MAX_OUTPUT_TOKENS,
        });

        lastModel = response.model;
        if (!response.content) throw new Error('Respuesta vacía de la IA');

        const parsed = auditSchema.parse(extractJson(response.content));

        const report = await prisma.aiReport.create({
          data: {
            crawlId,
            model: response.model,
            type: 'audit',
            input: context as unknown as Prisma.InputJsonValue,
            output: parsed as unknown as Prisma.InputJsonValue,
          },
        });

        // Envío opcional por correo, según las preferencias de la cuenta.
        await maybeEmailAiReport(report.id, user.id);

        return ok({ report });
      } catch (err) {
        if (err instanceof AiNotConfiguredError) return fail(err.message, 400);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    await prisma.aiReport.create({
      data: {
        crawlId,
        model: lastModel,
        type: 'audit',
        input: context as unknown as Prisma.InputJsonValue,
        error: lastError.slice(0, 2000),
      },
    });

    return fail(`La generación del informe falló: ${lastError}`, 502);
  });
}
