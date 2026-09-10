import { loadEnv } from '../lib/load-env';

loadEnv();

import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/auth';

/**
 * Utilidades de administración por línea de comandos.
 *
 * Sirven de vía de recuperación cuando no se puede entrar a la interfaz:
 * por ejemplo, si la única cuenta de admin se desactivó por error o si no
 * hay SMTP para recibir el enlace de invitación.
 *
 *   npm run admin -- list
 *   npm run admin -- promote <email>
 *   npm run admin -- create <email> [nombre]
 *   npm run admin -- reset <email>
 *   npm run admin -- password <email> <contraseña>
 */

async function list() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      email: true,
      name: true,
      role: true,
      isActive: true,
      passwordHash: true,
      lastLoginAt: true,
    },
  });

  if (users.length === 0) {
    console.log('No hay ninguna cuenta. Abre /register para crear la primera.');
    return;
  }

  for (const user of users) {
    const state = !user.passwordHash
      ? 'sin activar'
      : user.isActive
        ? 'activa'
        : 'desactivada';
    console.log(
      `${user.role.padEnd(6)} ${state.padEnd(12)} ${user.email}${user.name ? ` (${user.name})` : ''}`,
    );
  }
}

async function promote(email: string) {
  const user = await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: { role: 'ADMIN', isActive: true },
  });
  console.log(`${user.email} es ahora administrador.`);
}

async function inviteLink(userId: string, purpose: 'INVITE' | 'RESET') {
  const token = randomBytes(32).toString('hex');
  const hours = purpose === 'INVITE' ? 72 : 1;

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId,
      purpose,
      expiresAt: new Date(Date.now() + hours * 3600 * 1000),
    },
  });

  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${base}/reset-password?token=${token}`;
}

async function create(email: string, name?: string) {
  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (existing) {
    console.error(`Ya existe una cuenta con ${email}`);
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name: name ?? null,
      role: 'ADMIN',
      passwordHash: null,
    },
  });

  console.log(`Cuenta creada: ${user.email}`);
  console.log(`Enlace para establecer contraseña (72 h):`);
  console.log(await inviteLink(user.id, 'INVITE'));
}

async function reset(email: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user) {
    console.error(`No existe ninguna cuenta con ${email}`);
    process.exitCode = 1;
    return;
  }

  console.log('Enlace de recuperación (1 h):');
  console.log(await inviteLink(user.id, 'RESET'));
}

async function setPassword(email: string, password: string) {
  if (password.length < 8) {
    console.error('La contraseña debe tener al menos 8 caracteres');
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: { passwordHash: await hashPassword(password), isActive: true },
  });

  console.log(`Contraseña actualizada para ${email}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'list':
      await list();
      break;
    case 'promote':
      if (!args[0]) throw new Error('Uso: npm run admin -- promote <email>');
      await promote(args[0]);
      break;
    case 'create':
      if (!args[0]) throw new Error('Uso: npm run admin -- create <email> [nombre]');
      await create(args[0], args.slice(1).join(' ') || undefined);
      break;
    case 'reset':
      if (!args[0]) throw new Error('Uso: npm run admin -- reset <email>');
      await reset(args[0]);
      break;
    case 'password':
      if (!args[0] || !args[1]) {
        throw new Error('Uso: npm run admin -- password <email> <contraseña>');
      }
      await setPassword(args[0], args[1]);
      break;
    default:
      console.log(
        [
          'Comandos disponibles:',
          '  npm run admin -- list',
          '  npm run admin -- promote <email>',
          '  npm run admin -- create <email> [nombre]',
          '  npm run admin -- reset <email>',
          '  npm run admin -- password <email> <contraseña>',
        ].join('\n'),
      );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
