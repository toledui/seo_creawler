import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { handle, ok } from '@/lib/api';
import { passwordResetEmail, sendMail } from '@/lib/mailer';
import { getAppSettings } from '@/lib/settings';

const schema = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  return handle(async () => {
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email } });

    // Respondemos igual exista o no el usuario para no filtrar cuentas.
    if (!user) return ok({ success: true });

    const token = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        purpose: 'RESET',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const settings = await getAppSettings();
    const origin = settings.appUrl || new URL(request.url).origin;
    const resetUrl = `${origin}/reset-password?token=${token}`;

    const mail = passwordResetEmail(resetUrl);
    const sent = await sendMail({ to: user.email, ...mail });

    // Con SMTP configurado el enlace viaja sólo por correo. Sin SMTP
    // (desarrollo) lo devolvemos para poder completar el flujo en local.
    return ok({
      success: true,
      delivered: sent,
      resetUrl: sent ? undefined : resetUrl,
    });
  });
}
