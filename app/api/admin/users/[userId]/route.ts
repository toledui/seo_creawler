import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { getAppSettings } from '@/lib/settings';
import { invitationEmail, passwordResetEmail, sendMail } from '@/lib/mailer';

type Params = { params: Promise<{ userId: string }> };

const patchSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  role: z.enum(['ADMIN', 'MEMBER']).optional(),
  isActive: z.boolean().optional(),
  /** Reenvía la invitación o manda un enlace de recuperación. */
  action: z.enum(['resend-invite', 'send-reset']).optional(),
});

/** Impide que la instancia se quede sin ningún admin activo. */
async function otherActiveAdmins(userId: string): Promise<number> {
  return prisma.user.count({
    where: { role: 'ADMIN', isActive: true, id: { not: userId } },
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { userId } = await params;

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return fail('Cuenta no encontrada', 404);

    const body = patchSchema.parse(await request.json());

    // ---- Reenvío de enlaces
    if (body.action) {
      const isInvite = body.action === 'resend-invite';
      const hours = isInvite ? 72 : 1;

      const token = randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: {
          token,
          userId: target.id,
          purpose: isInvite ? 'INVITE' : 'RESET',
          expiresAt: new Date(Date.now() + hours * 3600 * 1000),
        },
      });

      const settings = await getAppSettings();
      const url = `${settings.appUrl}/reset-password?token=${token}`;

      const mail = isInvite
        ? invitationEmail({
            inviteUrl: url,
            invitedBy: admin.name ?? admin.email,
            appUrl: settings.appUrl,
            expiresInHours: hours,
          })
        : passwordResetEmail(url, 60);

      const sent = await sendMail({ to: target.email, ...mail });
      return ok({ delivered: sent, url: sent ? undefined : url });
    }

    // ---- Cambios de estado y rol
    if (
      (body.role === 'MEMBER' || body.isActive === false) &&
      target.role === 'ADMIN' &&
      (await otherActiveAdmins(target.id)) === 0
    ) {
      return fail(
        'No puedes dejar la instancia sin ningún administrador activo',
        409,
      );
    }

    if (body.isActive === false && target.id === admin.id) {
      return fail('No puedes desactivar tu propia cuenta', 409);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    return ok({ user: updated });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { userId } = await params;

    if (userId === admin.id) {
      return fail('No puedes eliminar tu propia cuenta', 409);
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return fail('Cuenta no encontrada', 404);

    if (target.role === 'ADMIN' && (await otherActiveAdmins(userId)) === 0) {
      return fail('No puedes eliminar al último administrador', 409);
    }

    // Los proyectos, crawls y keywords caen en cascada.
    await prisma.user.delete({ where: { id: userId } });
    return ok({ success: true });
  });
}
