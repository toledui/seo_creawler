import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createSession, hashPassword, needsBootstrap } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';

const schema = z.object({
  name: z.string().max(120).optional(),
  email: z.string().email(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

/**
 * Alta de la primera cuenta (bootstrap).
 *
 * El registro público está cerrado: esta ruta sólo funciona mientras no
 * exista ninguna cuenta, y la que crea es administradora. A partir de ahí
 * las altas se hacen desde el panel de administración.
 */
export async function POST(request: Request) {
  return handle(async () => {
    if (!(await needsBootstrap())) {
      return fail(
        'El registro está cerrado. Pide al administrador que te cree una cuenta.',
        403,
      );
    }

    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const user = await prisma.user.create({
      data: {
        email,
        name: body.name?.trim() || null,
        passwordHash: await hashPassword(body.password),
        role: 'ADMIN',
      },
      select: { id: true, email: true, name: true, role: true },
    });

    await createSession(user);
    return ok({ user });
  });
}

/** Permite a la pantalla de registro saber si sigue abierta. */
export async function GET() {
  return handle(async () => ok({ open: await needsBootstrap() }));
}
