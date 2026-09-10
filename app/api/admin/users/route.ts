import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { getAppSettings } from '@/lib/settings';
import { invitationEmail, sendMail } from '@/lib/mailer';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});

/** Horas que dura el enlace de invitación. */
const INVITE_HOURS = 72;

export async function GET() {
  return handle(async () => {
    await requireAdmin();

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        passwordHash: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { projects: true } },
        settings: { select: { deepseekApiKey: true } },
        gscAccount: { select: { googleEmail: true, refreshToken: true } },
      },
    });

    return ok({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        /** Sin contraseña = invitación aún sin aceptar. */
        pending: !user.passwordHash,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        projects: user._count.projects,
        hasAiKey: Boolean(user.settings?.deepseekApiKey),
        gscEmail: user.gscAccount?.refreshToken ? user.gscAccount.googleEmail : null,
      })),
    });
  });
}

/**
 * Crea una cuenta y le manda por correo el enlace para establecer su
 * contraseña.
 *
 * No se genera ni se envía una contraseña en claro: el usuario elige la
 * suya con un token de un solo uso, que es lo que evita que la credencial
 * quede escrita en un buzón.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = createSchema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return fail('Ya existe una cuenta con ese email', 409);

    const user = await prisma.user.create({
      data: {
        email,
        name: body.name?.trim() || null,
        role: body.role,
        passwordHash: null,
        invitedById: admin.id,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    const token = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        purpose: 'INVITE',
        expiresAt: new Date(Date.now() + INVITE_HOURS * 3600 * 1000),
      },
    });

    const settings = await getAppSettings();
    const inviteUrl = `${settings.appUrl}/reset-password?token=${token}`;

    const mail = invitationEmail({
      inviteUrl,
      invitedBy: admin.name ?? admin.email,
      appUrl: settings.appUrl,
      expiresInHours: INVITE_HOURS,
    });

    const sent = await sendMail({ to: user.email, ...mail });

    return ok(
      {
        user,
        delivered: sent,
        // Sin SMTP el admin pasa el enlace a mano.
        inviteUrl: sent ? undefined : inviteUrl,
      },
      { status: 201 },
    );
  });
}
