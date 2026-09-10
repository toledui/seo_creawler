import type { AccountRole } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Acceso a los espacios de trabajo.
 *
 * Cada usuario es dueño de su propio espacio (sus proyectos cuelgan de
 * `Project.userId`) y puede invitar a otras personas con permiso de
 * edición o de sólo lectura. Aquí se resuelve qué puede tocar cada quien.
 */

export type Permission = 'read' | 'write' | 'manage';

/** Qué permite cada rol. */
const CAPABILITIES: Record<AccountRole, Permission[]> = {
  OWNER: ['read', 'write', 'manage'],
  EDITOR: ['read', 'write'],
  VIEWER: ['read'],
};

export function roleAllows(role: AccountRole, permission: Permission): boolean {
  return CAPABILITIES[role].includes(permission);
}

export const ROLE_LABELS: Record<AccountRole, string> = {
  OWNER: 'Propietario',
  EDITOR: 'Editor',
  VIEWER: 'Sólo lectura',
};

/**
 * Ids de los espacios de trabajo que este usuario puede ver: el suyo y
 * aquellos a los que le han invitado.
 */
export async function accessibleOwnerIds(userId: string): Promise<string[]> {
  const memberships = await prisma.accountMember.findMany({
    where: { userId },
    select: { ownerId: true },
  });

  return [userId, ...memberships.map((m) => m.ownerId)];
}

/** Rol del usuario dentro de un espacio de trabajo concreto. */
export async function roleInAccount(
  ownerId: string,
  userId: string,
): Promise<AccountRole | null> {
  if (ownerId === userId) return 'OWNER';

  const membership = await prisma.accountMember.findUnique({
    where: { ownerId_userId: { ownerId, userId } },
    select: { role: true },
  });

  return membership?.role ?? null;
}

export class ForbiddenAccessError extends Error {}
export class NotFoundAccessError extends Error {}

function deny(permission: Permission): never {
  throw new ForbiddenAccessError(
    permission === 'manage'
      ? 'Sólo el propietario de la cuenta puede hacer esto'
      : 'Tu acceso a esta cuenta es de sólo lectura',
  );
}

/**
 * Comprueba el acceso a un proyecto y devuelve el proyecto con el rol.
 *
 * Lanza `NotFoundAccessError` si no existe o el usuario no tiene ningún
 * acceso (no distinguimos ambos casos para no filtrar qué proyectos hay),
 * y `ForbiddenAccessError` si tiene acceso pero le falta el permiso.
 */
export async function requireProjectAccess(
  projectId: string,
  userId: string,
  permission: Permission = 'read',
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundAccessError('Proyecto no encontrado');

  const role = await roleInAccount(project.userId, userId);
  if (!role) throw new NotFoundAccessError('Proyecto no encontrado');
  if (!roleAllows(role, permission)) deny(permission);

  return { project, role };
}

/** Igual que el anterior, pero partiendo de un crawl. */
export async function requireCrawlAccess(
  crawlId: string,
  userId: string,
  permission: Permission = 'read',
) {
  const crawl = await prisma.crawl.findUnique({
    where: { id: crawlId },
    include: { project: true },
  });
  if (!crawl) throw new NotFoundAccessError('Crawl no encontrado');

  const role = await roleInAccount(crawl.project.userId, userId);
  if (!role) throw new NotFoundAccessError('Crawl no encontrado');
  if (!roleAllows(role, permission)) deny(permission);

  return { crawl, role };
}

/** Filtro de Prisma para listar todo lo visible por el usuario. */
export async function visibleProjectsWhere(userId: string) {
  return { userId: { in: await accessibleOwnerIds(userId) } };
}

/**
 * Espacios de trabajo del usuario, con su rol, para pintar selectores y
 * avisos en la interfaz.
 */
export async function listWorkspaces(userId: string) {
  const memberships = await prisma.accountMember.findMany({
    where: { userId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const own = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  return [
    ...(own
      ? [
          {
            ownerId: own.id,
            ownerName: own.name,
            ownerEmail: own.email,
            role: 'OWNER' as AccountRole,
            isOwn: true,
          },
        ]
      : []),
    ...memberships.map((membership) => ({
      ownerId: membership.owner.id,
      ownerName: membership.owner.name,
      ownerEmail: membership.owner.email,
      role: membership.role,
      isOwn: false,
    })),
  ];
}
