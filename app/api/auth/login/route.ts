import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createSession, verifyPassword } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email } });

    // Mismo mensaje para email inexistente y contraseña incorrecta: no
    // filtramos qué cuentas existen.
    if (!user || !user.passwordHash) {
      return fail('Email o contraseña incorrectos', 401);
    }

    if (!(await verifyPassword(body.password, user.passwordHash))) {
      return fail('Email o contraseña incorrectos', 401);
    }

    if (!user.isActive) {
      return fail('Esta cuenta está desactivada. Contacta con el administrador.', 403);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await createSession({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    return ok({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });
}
