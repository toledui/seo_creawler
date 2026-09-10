import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { listWorkspaces, ROLE_LABELS } from '@/lib/access';
import { getAppSettings } from '@/lib/settings';
import { invitationEmail, sendMail } from '@/lib/mailer';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
  role: z.enum(['EDITOR', 'VIEWER']).default('VIEWER'),
});

const INVITE_HOURS = 72;

/**
 * Equipo del espacio de trabajo del usuario, más los espacios ajenos a los
 * que pertenece.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const [members, workspaces, settings] = await Promise.all([
      prisma.accountMember.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              isActive: true,
              passwordHash: true,
              lastLoginAt: true,
            },
          },
        },
      }),
      listWorkspaces(user.id),
      getAppSettings(),
    ]);

    return ok({
      roleLabels: ROLE_LABELS,
      smtpConfigured: settings.smtp.configured,
      members: members.map((member) => ({
        id: member.id,
        userId: member.user.id,
        email: member.user.email,
        name: member.user.name,
        role: member.role,
        isActive: member.user.isActive,
        /** Sin contraseña = invitación aún sin aceptar. */
        pending: !member.user.passwordHash,
        lastLoginAt: member.user.lastLoginAt,
        createdAt: member.createdAt,
      })),
      // Espacios ajenos: sirve para que sepa dónde más tiene acceso.
      workspaces: workspaces.filter((w) => !w.isOwn),
    });
  });
}

/**
 * Invita a alguien al espacio de trabajo.
 *
 * Si el email no tiene cuenta todavía se crea (sin contraseña) y se le
 * manda el enlace para establecerla. Si ya existe, sólo se le da acceso y
 * entra con su contraseña de siempre.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = createSchema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    if (email === user.email.toLowerCase()) {
      return fail('Ya eres el propietario de esta cuenta', 422);
    }

    let invited = await prisma.user.findUnique({ where: { email } });
    let isNewAccount = false;

    if (invited) {
      const existing = await prisma.accountMember.findUnique({
        where: { ownerId_userId: { ownerId: user.id, userId: invited.id } },
      });
      if (existing) return fail('Esa persona ya está en tu equipo', 409);
    } else {
      invited = await prisma.user.create({
        data: {
          email,
          name: body.name?.trim() || null,
          role: 'MEMBER',
          passwordHash: null,
          invitedById: user.id,
        },
      });
      isNewAccount = true;
    }

    await prisma.accountMember.create({
      data: {
        ownerId: user.id,
        userId: invited.id,
        role: body.role,
        invitedById: user.id,
      },
    });

    const settings = await getAppSettings();

    // Sólo hace falta enlace si la cuenta es nueva y no tiene contraseña.
    let inviteUrl: string | null = null;
    let delivered = false;

    if (isNewAccount || !invited.passwordHash) {
      const token = randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: {
          token,
          userId: invited.id,
          purpose: 'INVITE',
          expiresAt: new Date(Date.now() + INVITE_HOURS * 3600 * 1000),
        },
      });

      inviteUrl = `${settings.appUrl}/reset-password?token=${token}`;

      delivered = await sendMail({
        to: email,
        ...invitationEmail({
          inviteUrl,
          invitedBy: user.name ?? user.email,
          appUrl: settings.appUrl,
          expiresInHours: INVITE_HOURS,
        }),
      });
    }

    return ok(
      {
        member: {
          userId: invited.id,
          email: invited.email,
          role: body.role,
          pending: isNewAccount || !invited.passwordHash,
        },
        isNewAccount,
        delivered,
        // Sin SMTP el propietario pasa el enlace a mano.
        inviteUrl: delivered ? undefined : inviteUrl ?? undefined,
      },
      { status: 201 },
    );
  });
}
