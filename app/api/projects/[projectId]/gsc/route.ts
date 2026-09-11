import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import {
  adoptLegacyProjects,
  buildAuthUrl,
  gscConfigured,
  listAccountsWithSites,
  oauthRedirectUri,
} from '@/src/keywords/gsc-client';

type Params = { params: Promise<{ projectId: string }> };

const patchSchema = z.object({
  siteUrl: z.string().max(500).nullable(),
  accountId: z.string().max(64).nullable().optional(),
});

/**
 * Estado de Search Console para un proyecto.
 *
 * La autorización es de la cuenta (que puede tener varias cuentas de
 * Google); aquí sólo se elige con qué cuenta y qué propiedad se mide este
 * proyecto en concreto.
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    const project = await assertProjectOwner(projectId, user.id);

    // Las cuentas de Google son del dueño del proyecto: son las que usa
    // el tracking diario.
    await adoptLegacyProjects(project.userId);

    const [configured, accounts, current] = await Promise.all([
      gscConfigured(),
      listAccountsWithSites(project.userId),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { gscSiteUrl: true, gscAccountId: true },
      }),
    ]);

    // Sólo el dueño puede conectar sus cuentas de Google.
    const isOwner = project.userId === user.id;

    return ok({
      configured,
      connected: accounts.length > 0,
      redirectUri: await oauthRedirectUri(),
      // Tras autorizar, el callback devuelve al usuario a este proyecto.
      authUrl:
        configured && isOwner
          ? await buildAuthUrl(`/projects/${projectId}/keywords`)
          : null,
      siteUrl: current?.gscSiteUrl ?? null,
      accountId: current?.gscAccountId ?? null,
      accounts: accounts.map((account) => ({
        id: account.id,
        googleEmail: account.googleEmail,
        lastError: account.lastError,
        sites: account.sites,
        sitesError: account.sitesError,
      })),
    });
  });
}

/** Selecciona con qué cuenta de Google y qué propiedad se mide este proyecto. */
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    const project = await assertProjectWrite(projectId, user.id);

    const body = patchSchema.parse(await request.json());
    const siteUrl = body.siteUrl || null;
    const accountId = siteUrl ? body.accountId || null : null;

    if (accountId) {
      const account = await prisma.gscAccount.findFirst({
        where: { id: accountId, userId: project.userId },
        select: { id: true },
      });
      if (!account) return fail('Esa cuenta de Google no pertenece a este espacio', 400);
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { gscSiteUrl: siteUrl, gscAccountId: accountId },
      select: { gscSiteUrl: true, gscAccountId: true },
    });

    return ok({ siteUrl: updated.gscSiteUrl, accountId: updated.gscAccountId });
  });
}
