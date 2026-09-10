import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { getAppSettings } from '@/lib/settings';
import { invitationEmail, sendMail } from '@/lib/mailer';

type Params = { params: Promise<{ memberId: string }> };

const patchSchema = z.object({
  role: z.enum(['EDITOR', 'VIEWER']).optional(),
  action: z.literal('resend-invite').optional(),
});

/**
 * Sólo el propietario del espacio de trabajo gestiona su equipo: la
 * pertenencia se busca siempre acotada por `ownerId`, así que nadie puede
 * tocar el equipo de otro aunque adivine el id.
 */
async function membershipOf(memberId: string, ownerId: string) {
  return prisma.accountMember.findFirst({
    where: { id: memberId, ownerId },
    include: { user: { select: { id: true, email: true, passwordHash: true } } },
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { memberId } = await params;

    const membership = await membershipOf(memberId, user.id);
    if (!membership) return fail('Miembro no encontrado', 404);

    const body = patchSchema.parse(await request.json());

    if (body.action === 'resend-invite') {
      const token = randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: {
          token,
          userId: membership.userId,
          purpose: membership.user.passwordHash ? 'RESET' : 'INVITE',
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
      });

      const settings = await getAppSettings();
      const url = `${settings.appUrl}/reset-password?token=${token}`;

      const delivered = await sendMail({
        to: membership.user.email,
        ...invitationEmail({
          inviteUrl: url,
          invitedBy: user.name ?? user.email,
          appUrl: settings.appUrl,
          expiresInHours: 72,
        }),
      });

      return ok({ delivered, url: delivered ? undefined : url });
    }

    if (!body.role) return fail('Nada que actualizar', 422);

    const updated = await prisma.accountMember.update({
      where: { id: memberId },
      data: { role: body.role },
      select: { id: true, role: true },
    });

    return ok({ member: updated });
  });
}

/** Quita el acceso, sin borrar la cuenta de la persona. */
export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { memberId } = await params;

    const deleted = await prisma.accountMember.deleteMany({
      where: { id: memberId, ownerId: user.id },
    });

    if (deleted.count === 0) return fail('Miembro no encontrado', 404);
    return ok({ success: true });
  });
}
