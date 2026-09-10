import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import {
  getAppSettings,
  getUserAiConfig,
  getUserSettings,
  setUserAiConfig,
  setUserNotificationSettings,
} from '@/lib/settings';
import { maskSecret } from '@/lib/crypto';
import { chat } from '@/src/ai/deepseek-client';
import {
  accountConnected,
  buildAuthUrl,
  gscConfigured,
  listSites,
} from '@/src/keywords/gsc-client';

const patchSchema = z.object({
  name: z.string().max(120).nullable().optional(),

  /** Cadena vacía = borrar la clave; ausente = no tocar. */
  deepseekApiKey: z.string().max(500).nullable().optional(),
  deepseekModel: z.string().max(120).nullable().optional(),
  deepseekBaseUrl: z.string().max(255).nullable().optional(),

  emailOnCrawlComplete: z.boolean().optional(),
  emailOnAiReport: z.boolean().optional(),
  notifyEmail: z.string().email().nullable().optional(),
});

const actionSchema = z.object({
  action: z.enum(['test-ai', 'disconnect-gsc']),
});

/** Todo lo que la cuenta puede configurar por su cuenta. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const [settings, ai, app, connected] = await Promise.all([
      getUserSettings(user.id),
      getUserAiConfig(user.id),
      getAppSettings(),
      accountConnected(user.id),
    ]);

    const account = connected
      ? await prisma.gscAccount.findUnique({
          where: { userId: user.id },
          select: { googleEmail: true, lastError: true, updatedAt: true },
        })
      : null;

    let sites: { siteUrl: string; permissionLevel: string }[] = [];
    let sitesError: string | null = null;

    if (connected) {
      try {
        sites = await listSites(user.id);
      } catch (err) {
        sitesError = err instanceof Error ? err.message : String(err);
      }
    }

    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, domain: true, gscSiteUrl: true },
    });

    return ok({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },

      ai: {
        configured: ai.configured,
        hasOwnKey: settings.hasOwnAiKey,
        // Si la clave viene del .env se dice claramente: no es de la cuenta.
        fromEnvFallback: ai.fromEnvFallback,
        keyHint: settings.hasOwnAiKey ? maskSecret(ai.apiKey) : null,
        model: ai.model,
        baseUrl: ai.baseUrl,
      },

      notifications: {
        emailOnCrawlComplete: settings.emailOnCrawlComplete,
        emailOnAiReport: settings.emailOnAiReport,
        notifyEmail: settings.notifyEmail,
        smtpConfigured: app.smtp.configured,
        reportsEnabled: app.email.reportsEnabled,
      },

      gsc: {
        configured: await gscConfigured(),
        connected,
        googleEmail: account?.googleEmail ?? null,
        lastError: account?.lastError ?? null,
        connectedAt: account?.updatedAt ?? null,
        authUrl: (await gscConfigured()) ? await buildAuthUrl('/settings') : null,
        sites,
        sitesError,
        projects,
      },
    });
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = patchSchema.parse(await request.json());

    if (body.name !== undefined) {
      await prisma.user.update({
        where: { id: user.id },
        data: { name: body.name },
      });
    }

    if (
      body.deepseekApiKey !== undefined ||
      body.deepseekModel !== undefined ||
      body.deepseekBaseUrl !== undefined
    ) {
      await setUserAiConfig(user.id, {
        apiKey: body.deepseekApiKey,
        model: body.deepseekModel,
        baseUrl: body.deepseekBaseUrl,
      });
    }

    if (
      body.emailOnCrawlComplete !== undefined ||
      body.emailOnAiReport !== undefined ||
      body.notifyEmail !== undefined
    ) {
      await setUserNotificationSettings(user.id, {
        emailOnCrawlComplete: body.emailOnCrawlComplete,
        emailOnAiReport: body.emailOnAiReport,
        notifyEmail: body.notifyEmail,
      });
    }

    return ok({ success: true });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = actionSchema.parse(await request.json());

    if (body.action === 'disconnect-gsc') {
      await prisma.gscAccount.deleteMany({ where: { userId: user.id } });
      await prisma.project.updateMany({
        where: { userId: user.id },
        data: { gscSiteUrl: null },
      });
      return ok({ success: true });
    }

    // Prueba de la clave de IA con la llamada más barata posible.
    const config = await getUserAiConfig(user.id);
    if (!config.configured) return fail('No hay clave de IA configurada', 400);

    try {
      const response = await chat({
        config,
        messages: [{ role: 'user', content: 'Responde únicamente: ok' }],
        maxTokens: 5,
        temperature: 0,
      });

      return ok({
        success: true,
        message: `Conexión correcta con ${response.model}`,
      });
    } catch (err) {
      return fail(
        `La clave no funciona: ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }
  });
}
