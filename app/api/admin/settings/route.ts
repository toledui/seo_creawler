import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import {
  APP_SETTING_KEYS,
  getAppSettings,
  setAppSettings,
} from '@/lib/settings';
import { maskSecret } from '@/lib/crypto';
import { sendMail, testEmail, verifySmtp } from '@/lib/mailer';
import { verifySerplify } from '@/src/serp/serplify-client';

const schema = z.object({
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.string().max(6).nullable().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(255).nullable().optional(),
  /** Cadena vacía = borrar; ausente = no tocar. */
  smtpPassword: z.string().max(500).nullable().optional(),
  smtpFrom: z.string().max(255).nullable().optional(),

  googleClientId: z.string().max(255).nullable().optional(),
  googleClientSecret: z.string().max(500).nullable().optional(),

  emailReportsEnabled: z.boolean().optional(),
  appUrl: z.string().max(255).nullable().optional(),

  serplifyApiKey: z.string().max(500).nullable().optional(),
  serplifyBaseUrl: z.string().max(255).nullable().optional(),
  serplifyEnabled: z.boolean().optional(),
});

const actionSchema = z.object({
  action: z.enum(['test-smtp', 'send-test-email', 'test-serplify']),
  to: z.string().email().optional(),
});

/**
 * Configuración global. Los secretos no se devuelven nunca en claro:
 * sólo se indica si están puestos y sus últimos caracteres.
 */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const settings = await getAppSettings();

    return ok({
      smtp: {
        host: settings.smtp.host,
        port: settings.smtp.port,
        secure: settings.smtp.secure,
        user: settings.smtp.user,
        passwordSet: Boolean(settings.smtp.password),
        passwordHint: maskSecret(settings.smtp.password),
        from: settings.smtp.from,
        configured: settings.smtp.configured,
      },
      google: {
        clientId: settings.google.clientId,
        clientSecretSet: Boolean(settings.google.clientSecret),
        clientSecretHint: maskSecret(settings.google.clientSecret),
        configured: settings.google.configured,
        redirectUri: `${settings.appUrl}/api/auth/google/callback`,
      },
      email: settings.email,
      serplify: {
        apiKeySet: Boolean(settings.serplify.apiKey),
        apiKeyHint: maskSecret(settings.serplify.apiKey),
        baseUrl: settings.serplify.baseUrl,
        enabled: settings.serplify.enabled,
        configured: settings.serplify.configured,
      },
      appUrl: settings.appUrl,
    });
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const body = schema.parse(await request.json());

    const values: Record<string, string | null> = {};
    const put = (key: string, value: string | null | undefined) => {
      if (value !== undefined) values[key] = value;
    };

    put(APP_SETTING_KEYS.smtpHost, body.smtpHost);
    put(APP_SETTING_KEYS.smtpPort, body.smtpPort);
    put(APP_SETTING_KEYS.smtpUser, body.smtpUser);
    put(APP_SETTING_KEYS.smtpPassword, body.smtpPassword);
    put(APP_SETTING_KEYS.smtpFrom, body.smtpFrom);
    put(APP_SETTING_KEYS.googleClientId, body.googleClientId);
    put(APP_SETTING_KEYS.googleClientSecret, body.googleClientSecret);
    put(APP_SETTING_KEYS.appUrl, body.appUrl);
    put(APP_SETTING_KEYS.serplifyApiKey, body.serplifyApiKey);
    put(APP_SETTING_KEYS.serplifyBaseUrl, body.serplifyBaseUrl);

    if (body.smtpSecure !== undefined) {
      values[APP_SETTING_KEYS.smtpSecure] = String(body.smtpSecure);
    }
    if (body.emailReportsEnabled !== undefined) {
      values[APP_SETTING_KEYS.emailReportsEnabled] = String(
        body.emailReportsEnabled,
      );
    }
    if (body.serplifyEnabled !== undefined) {
      values[APP_SETTING_KEYS.serplifyEnabled] = String(body.serplifyEnabled);
    }

    await setAppSettings(values);
    return ok({ success: true });
  });
}

/** Prueba la conexión SMTP o envía un correo de comprobación. */
export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = actionSchema.parse(await request.json());

    if (body.action === 'test-serplify') {
      // Usa /v1/languages, que es gratuito: probar no gasta saldo.
      const result = await verifySerplify();
      if (!result.ok) return fail(result.error ?? 'La conexión falló', 400);
      return ok({
        success: true,
        message: `Conexión correcta con Serplify (${result.languages} idiomas disponibles)`,
      });
    }

    if (body.action === 'test-smtp') {
      const result = await verifySmtp();
      if (!result.ok) return fail(result.error ?? 'La conexión SMTP falló', 400);
      return ok({ success: true, message: 'Conexión SMTP correcta' });
    }

    const settings = await getAppSettings();
    const to = body.to ?? admin.email;
    const sent = await sendMail({ to, ...testEmail(settings.appUrl) });

    if (!sent) {
      return fail('No se pudo enviar el correo. Revisa la configuración SMTP.', 400);
    }

    return ok({ success: true, message: `Correo de prueba enviado a ${to}` });
  });
}
