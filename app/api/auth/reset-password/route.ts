import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';

const schema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = schema.parse(await request.json());

    const record = await prisma.passwordResetToken.findUnique({
      where: { token: body.token },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return fail('El enlace de recuperación no es válido o ha caducado', 400);
    }

    const passwordHash = await hashPassword(body.password);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        // Aceptar una invitación también activa la cuenta.
        data: { passwordHash, isActive: true },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Los demás enlaces pendientes de esa cuenta dejan de valer.
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    return ok({ success: true, purpose: record.purpose });
  });
}

/** Permite a la pantalla saber si el enlace es una invitación o un reset. */
export async function GET(request: Request) {
  return handle(async () => {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return fail('Falta el token', 400);

    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: { select: { email: true, name: true } } },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return fail('El enlace no es válido o ha caducado', 400);
    }

    return ok({
      purpose: record.purpose,
      email: record.user.email,
      name: record.user.name,
    });
  });
}
