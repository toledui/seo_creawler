import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import {
  accountConnected,
  gscConfigured,
  listSites,
} from '@/src/keywords/gsc-client';

type Params = { params: Promise<{ projectId: string }> };

const patchSchema = z.object({ siteUrl: z.string().max(500).nullable() });

/**
 * Estado de Search Console para un proyecto.
 *
 * La autorización es de la cuenta; aquí sólo se elige qué propiedad mide
 * este proyecto en concreto.
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    const project = await assertProjectOwner(projectId, user.id);

    const [configured, connected] = await Promise.all([
      gscConfigured(),
      accountConnected(user.id),
    ]);

    let sites: { siteUrl: string; permissionLevel: string }[] = [];
    let sitesError: string | null = null;

    if (connected) {
      try {
        sites = await listSites(user.id);
      } catch (err) {
        sitesError = err instanceof Error ? err.message : String(err);
      }
    }

    const account = connected
      ? await prisma.gscAccount.findUnique({
          where: { userId: user.id },
          select: { googleEmail: true, lastError: true, updatedAt: true },
        })
      : null;

    return ok({
      configured,
      connected,
      siteUrl: project.gscSiteUrl,
      account: account
        ? {
            googleEmail: account.googleEmail,
            lastError: account.lastError,
            connectedAt: account.updatedAt,
          }
        : null,
      sites,
      sitesError,
    });
  });
}

/** Selecciona qué propiedad de Search Console mide este proyecto. */
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectWrite(projectId, user.id);

    const body = patchSchema.parse(await request.json());

    const project = await prisma.project.update({
      where: { id: projectId },
      data: { gscSiteUrl: body.siteUrl || null },
      select: { gscSiteUrl: true },
    });

    return ok({ siteUrl: project.gscSiteUrl });
  });
}
