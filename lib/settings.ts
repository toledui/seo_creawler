import { prisma } from './prisma';
import { decrypt, encrypt } from './crypto';
import { env } from './env';

/**
 * Configuración de la instancia y de cada cuenta.
 *
 * Lo global (SMTP, OAuth de Google, envío de informes) se edita desde el
 * panel de admin y vive en `AppSetting`. Lo de cada cuenta (clave de IA,
 * preferencias de correo) vive en `UserSettings`.
 *
 * Las variables de entorno siguen valiendo como valor por defecto: si la
 * base no tiene el ajuste, se usa el del `.env`. Así una instalación
 * existente sigue funcionando sin tocar nada.
 */

export const APP_SETTING_KEYS = {
  smtpHost: 'smtp.host',
  smtpPort: 'smtp.port',
  smtpSecure: 'smtp.secure',
  smtpUser: 'smtp.user',
  smtpPassword: 'smtp.password',
  smtpFrom: 'smtp.from',

  googleClientId: 'google.clientId',
  googleClientSecret: 'google.clientSecret',

  emailReportsEnabled: 'email.reportsEnabled',
  appUrl: 'app.url',

  serplifyApiKey: 'serplify.apiKey',
  serplifyBaseUrl: 'serplify.baseUrl',
  serplifyEnabled: 'serplify.enabled',
} as const;

const SECRET_KEYS = new Set<string>([
  APP_SETTING_KEYS.smtpPassword,
  APP_SETTING_KEYS.googleClientSecret,
  APP_SETTING_KEYS.serplifyApiKey,
]);

export type AppSettings = {
  smtp: {
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    password: string | null;
    from: string;
    configured: boolean;
  };
  google: {
    clientId: string | null;
    clientSecret: string | null;
    configured: boolean;
  };
  email: { reportsEnabled: boolean };
  /**
   * Serplify es una sola clave para toda la instancia: el saldo es
   * prepago y compartido, así que no tiene sentido una por cuenta.
   */
  serplify: {
    apiKey: string | null;
    baseUrl: string;
    enabled: boolean;
    configured: boolean;
  };
  appUrl: string;
};

/** Cache corta: estos ajustes se leen en casi cada request. */
let cache: { value: AppSettings; expires: number } | null = null;
const CACHE_MS = 15_000;

export function invalidateSettingsCache() {
  cache = null;
}

async function rawSettings(): Promise<Map<string, string | null>> {
  const rows = await prisma.appSetting.findMany();
  return new Map(
    rows.map((row) => [
      row.key,
      row.isSecret ? decrypt(row.value) : row.value,
    ]),
  );
}

export async function getAppSettings(): Promise<AppSettings> {
  if (cache && cache.expires > Date.now()) return cache.value;

  const raw = await rawSettings();
  const get = (key: string, fallback?: string) =>
    raw.get(key)?.trim() || fallback || null;

  const smtpHost = get(APP_SETTING_KEYS.smtpHost, process.env.SMTP_HOST);
  const clientId = get(
    APP_SETTING_KEYS.googleClientId,
    process.env.GOOGLE_CLIENT_ID,
  );
  const clientSecret = get(
    APP_SETTING_KEYS.googleClientSecret,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  const serplifyKey = get(
    APP_SETTING_KEYS.serplifyApiKey,
    process.env.SERPLIFY_API_KEY,
  );

  const value: AppSettings = {
    smtp: {
      host: smtpHost,
      port: Number(get(APP_SETTING_KEYS.smtpPort, process.env.SMTP_PORT) ?? 587),
      secure:
        (get(APP_SETTING_KEYS.smtpSecure, process.env.SMTP_SECURE) ?? 'false') ===
        'true',
      user: get(APP_SETTING_KEYS.smtpUser, process.env.SMTP_USER),
      password: get(APP_SETTING_KEYS.smtpPassword, process.env.SMTP_PASSWORD),
      from:
        get(APP_SETTING_KEYS.smtpFrom, process.env.SMTP_FROM) ??
        'SEO Crawler <no-reply@localhost>',
      configured: Boolean(smtpHost),
    },
    google: {
      clientId,
      clientSecret,
      configured: Boolean(clientId && clientSecret),
    },
    email: {
      reportsEnabled:
        (get(APP_SETTING_KEYS.emailReportsEnabled) ?? 'true') === 'true',
    },
    serplify: {
      apiKey: serplifyKey,
      baseUrl:
        get(APP_SETTING_KEYS.serplifyBaseUrl, process.env.SERPLIFY_BASE_URL) ??
        'https://api.serplify.io',
      // Se puede apagar sin borrar la clave, para cortar el gasto de golpe.
      enabled: (get(APP_SETTING_KEYS.serplifyEnabled) ?? 'true') === 'true',
      configured: Boolean(serplifyKey),
    },
    appUrl:
      get(APP_SETTING_KEYS.appUrl, process.env.NEXTAUTH_URL) ??
      'http://localhost:3000',
  };

  cache = { value, expires: Date.now() + CACHE_MS };
  return value;
}

/** Guarda ajustes globales; los secretos se cifran antes de escribir. */
export async function setAppSettings(values: Record<string, string | null>) {
  for (const [key, value] of Object.entries(values)) {
    const isSecret = SECRET_KEYS.has(key);

    // Cadena vacía = borrar el ajuste y volver al valor del entorno.
    if (value === null || value === '') {
      await prisma.appSetting.deleteMany({ where: { key } });
      continue;
    }

    const stored = isSecret ? encrypt(value) : value;

    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: stored, isSecret },
      update: { value: stored, isSecret },
    });
  }

  invalidateSettingsCache();
}

// ------------------------------------------------------- Ajustes de cuenta

export type UserAiConfig = {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  configured: boolean;
  /** true si la clave viene del .env y no de los ajustes de la cuenta. */
  fromEnvFallback: boolean;
};

/**
 * Configuración de IA de una cuenta.
 *
 * La clave es de cada cuenta: no hay una global compartida. Se mantiene el
 * valor del `.env` como red de seguridad para la instalación que ya venía
 * funcionando así, y la UI lo indica explícitamente.
 */
export async function getUserAiConfig(userId: string): Promise<UserAiConfig> {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });

  const own = decrypt(settings?.deepseekApiKey);
  const envKey = env.deepseek.apiKey || null;
  const apiKey = own || envKey;

  return {
    apiKey,
    model: settings?.deepseekModel?.trim() || env.deepseek.model,
    baseUrl: settings?.deepseekBaseUrl?.trim() || env.deepseek.baseUrl,
    configured: Boolean(apiKey),
    fromEnvFallback: !own && Boolean(envKey),
  };
}

export async function setUserAiConfig(
  userId: string,
  values: {
    apiKey?: string | null;
    model?: string | null;
    baseUrl?: string | null;
  },
) {
  const data: Record<string, string | null> = {};

  if (values.apiKey !== undefined) {
    data.deepseekApiKey = values.apiKey ? encrypt(values.apiKey) : null;
  }
  if (values.model !== undefined) data.deepseekModel = values.model || null;
  if (values.baseUrl !== undefined) data.deepseekBaseUrl = values.baseUrl || null;

  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function getUserSettings(userId: string) {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });

  return {
    emailOnCrawlComplete: settings?.emailOnCrawlComplete ?? false,
    emailOnAiReport: settings?.emailOnAiReport ?? false,
    notifyEmail: settings?.notifyEmail ?? null,
    hasOwnAiKey: Boolean(settings?.deepseekApiKey),
    deepseekModel: settings?.deepseekModel ?? null,
    deepseekBaseUrl: settings?.deepseekBaseUrl ?? null,
  };
}

export async function setUserNotificationSettings(
  userId: string,
  values: {
    emailOnCrawlComplete?: boolean;
    emailOnAiReport?: boolean;
    notifyEmail?: string | null;
  },
) {
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...values },
    update: values,
  });
}
