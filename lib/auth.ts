import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { env } from './env';
import { requireCrawlAccess, requireProjectAccess } from './access';

const COOKIE = 'seocrawler_session';
const secret = new TextEncoder().encode(env.authSecret);

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'MEMBER';
};

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      email: String(payload.email ?? ''),
      name: (payload.name as string) ?? null,
      role: payload.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
    };
  } catch {
    return null;
  }
}

/**
 * Comprueba contra la base que la cuenta sigue activa y con el rol que
 * dice el token.
 *
 * El JWT dura 30 días, así que desactivar una cuenta o quitarle el rol de
 * admin no puede depender sólo de lo que venga firmado en la cookie.
 */
export async function getVerifiedUser(): Promise<SessionUser | null> {
  const session = await getSessionUser();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

/** Lanza si no hay sesión válida. Usar en Server Components y Route Handlers. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getVerifiedUser();
  if (!user) throw new AuthError('No autenticado');
  return user;
}

/** Lanza si la cuenta no es administradora. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') {
    throw new ForbiddenError('Necesitas permisos de administrador');
  }
  return user;
}

export class AuthError extends Error {}
export class ForbiddenError extends Error {}

/**
 * ¿Es la primera vez que se arranca la instancia?
 *
 * Con el registro público cerrado hace falta una vía para crear el primer
 * administrador; se permite sólo mientras no exista ninguna cuenta.
 */
export async function needsBootstrap(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

/**
 * Acceso de LECTURA a un proyecto.
 *
 * Vale tanto para el dueño del espacio de trabajo como para las personas
 * invitadas, sea cual sea su rol. Las rutas que modifican datos deben usar
 * `assertProjectWrite`.
 */
export async function assertProjectOwner(projectId: string, userId: string) {
  const { project } = await requireProjectAccess(projectId, userId, 'read');
  return project;
}

/** Acceso de ESCRITURA a un proyecto: dueño o editor. */
export async function assertProjectWrite(projectId: string, userId: string) {
  const { project } = await requireProjectAccess(projectId, userId, 'write');
  return project;
}

/** Acceso de LECTURA a un crawl (vía su proyecto). */
export async function assertCrawlOwner(crawlId: string, userId: string) {
  const { crawl } = await requireCrawlAccess(crawlId, userId, 'read');
  return crawl;
}

/** Acceso de ESCRITURA a un crawl: dueño o editor. */
export async function assertCrawlWrite(crawlId: string, userId: string) {
  const { crawl } = await requireCrawlAccess(crawlId, userId, 'write');
  return crawl;
}
