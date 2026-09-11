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
  adoptLegacyProjects,
  buildAuthUrl,
  gscConfigured,
  listAccountsWithSites,
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
  /** Cuenta de Google a desconectar (sólo para disconnect-gsc). */
  accountId: z.string().max(64).optional(),
});

/** Todo lo que la cuenta puede configurar por su cuenta. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    await adoptLegacyProjects(user.id);

    const [settings, ai, app, accounts, configured] = await Promise.all([
      getUserSettings(user.id),
      getUserAiConfig(user.id),
      getAppSettings(),
      listAccountsWithSites(user.id),
      gscConfigured(),
    ]);

    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        domain: true,
        gscSiteUrl: true,
        gscAccountId: true,
      },
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
        configured,
        connected: accounts.length > 0,
        authUrl: configured ? await buildAuthUrl('/settings') : null,
        accounts: await Promise.all(
          accounts.map(async (account) => ({
            ...account,
            reconnectUrl: configured
              ? await buildAuthUrl('/settings', account.googleEmail)
              : null,
          })),
        ),
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
      if (!body.accountId) return fail('Falta la cuenta de Google a desconectar', 400);

      const account = await prisma.gscAccount.findFirst({
        where: { id: body.accountId, userId: user.id },
        select: { id: true, googleEmail: true },
      });
      if (!account) return fail('Cuenta de Google no encontrada', 404);

      // Primero se fijan los proyectos antiguos a su cuenta, para que al
      // quitar ésta no pasen en silencio a medirse con otra.
      await adoptLegacyProjects(user.id);

      await prisma.project.updateMany({
        where: { userId: user.id, gscAccountId: account.id },
        data: { gscSiteUrl: null, gscAccountId: null },
      });
      await prisma.gscAccount.delete({ where: { id: account.id } });

      return ok({
        success: true,
        message: `Desconectada ${account.googleEmail ?? 'la cuenta de Google'}`,
      });
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
