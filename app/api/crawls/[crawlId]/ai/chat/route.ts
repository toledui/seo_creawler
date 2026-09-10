import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertCrawlOwner, assertCrawlWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { getUserAiConfig } from '@/lib/settings';
import { chat, type ChatMessage } from '@/src/ai/deepseek-client';
import { CHAT_SYSTEM_PROMPT, toolDefinitions, toolHandlers } from '@/src/ai/tools';

type Params = { params: Promise<{ crawlId: string }> };

export const maxDuration = 300;

const schema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
});

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 20;

/** Conversaciones guardadas de este crawl. */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    await assertCrawlOwner(crawlId, user.id);

    const conversationId = new URL(request.url).searchParams.get('conversationId');

    if (conversationId) {
      const conversation = await prisma.aiConversation.findFirst({
        where: { id: conversationId, crawlId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!conversation) return fail('Conversación no encontrada', 404);
      return ok({ conversation });
    }

    const conversations = await prisma.aiConversation.findMany({
      where: { crawlId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { _count: { select: { messages: true } } },
    });

    const ai = await getUserAiConfig(user.id);
    return ok({ conversations, enabled: ai.configured });
  });
}

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    await assertCrawlWrite(crawlId, user.id);

    const ai = await getUserAiConfig(user.id);
    if (!ai.configured) {
      return fail(
        'Tu cuenta no tiene clave de IA. Configúrala en Ajustes → Inteligencia artificial.',
        400,
      );
    }

    const body = schema.parse(await request.json());

    // El historial vive en base de datos, no en el cliente: así la
    // conversación sobrevive a recargas y se puede auditar después.
    let conversation = body.conversationId
      ? await prisma.aiConversation.findFirst({
          where: { id: body.conversationId, crawlId },
        })
      : null;

    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: {
          crawlId,
          title: body.message.slice(0, 120),
        },
      });
    }

    const history = await prisma.aiMessage.findMany({
      where: {
        conversationId: conversation.id,
        role: { in: ['user', 'assistant'] },
      },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...history
        .reverse()
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: body.message },
    ];

    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: body.message,
      },
    });

    const toolTrace: { name: string; args: unknown }[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await chat({
        config: ai,
        messages,
        tools: toolDefinitions,
        temperature: 0.3,
        maxTokens: 3000,
      });

      if (response.toolCalls.length === 0) {
        const reply = response.content ?? '(sin respuesta)';

        await prisma.aiMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: reply,
            toolCalls: toolTrace.length
              ? (toolTrace as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });

        return ok({
          conversationId: conversation.id,
          reply,
          tools: toolTrace,
          model: response.model,
        });
      }

      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        const handler = toolHandlers[call.function.name];

        let result: unknown;
        if (!handler) {
          result = { error: `Herramienta desconocida: ${call.function.name}` };
        } else {
          let args: Record<string, unknown> = {};
          try {
            args = call.function.arguments
              ? JSON.parse(call.function.arguments)
              : {};
          } catch {
            args = {};
          }

          toolTrace.push({ name: call.function.name, args });

          try {
            result = await handler(crawlId, args);
          } catch (err) {
            result = {
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result, (_k, v) =>
            typeof v === 'bigint' ? v.toString() : v,
          ).slice(0, 30_000),
        });
      }
    }

    return fail(
      'La IA no llegó a una respuesta tras varias consultas a los datos',
      504,
    );
  });
}
