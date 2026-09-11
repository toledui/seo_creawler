import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVerifiedUser } from '@/lib/auth';
import { getAppSettings } from '@/lib/settings';
import {
  adoptLegacyProjects,
  emailFromIdToken,
  exchangeCode,
  listSites,
  saveTokens,
} from '@/src/keywords/gsc-client';

/**
 * Callback OAuth de Google.
 *
 * La autorización se guarda a nivel de cuenta; una cuenta de la app puede
 * tener varias cuentas de Google conectadas. `state` lleva a dónde volver,
 * y se valida que sea una ruta interna para que un enlace manipulado no
 * pueda usarse como redirección abierta.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '/settings';
  const oauthError = url.searchParams.get('error');

  const settings = await getAppSettings();
  const origin = settings.appUrl || url.origin;

  const safePath = state.startsWith('/') && !state.startsWith('//') ? state : '/settings';

  const back = (params: Record<string, string>) =>
    NextResponse.redirect(
      new URL(`${safePath}?${new URLSearchParams(params)}`, origin),
    );

  if (oauthError) return back({ gsc: 'error', message: oauthError });
  if (!code) return back({ gsc: 'error', message: 'Respuesta incompleta de Google' });

  const user = await getVerifiedUser();
  if (!user) return NextResponse.redirect(new URL('/login', origin));

  try {
    const tokens = await exchangeCode(code);

    if (!tokens.refresh_token) {
      const existing = await prisma.gscAccount.findFirst({
        where: { userId: user.id, googleEmail: emailFromIdToken(tokens.id_token) },
        select: { refreshToken: true },
      });

      // Google sólo entrega refresh token en la primera autorización.
      if (!existing?.refreshToken) {
        return back({
          gsc: 'error',
          message:
            'Google no devolvió refresh token. Revoca el acceso de la app en tu cuenta de Google y vuelve a conectar.',
        });
      }
    }

    // Antes de añadir una cuenta nueva, los proyectos antiguos quedan
    // atados a la que ya usaban.
    await adoptLegacyProjects(user.id);

    const accountId = await saveTokens(user.id, tokens);

    // Asigna las propiedades de esta cuenta a los proyectos sin propiedad
    // cuyo dominio coincide: así conectar suele ser realmente un botón.
    try {
      const sites = await listSites(accountId);
      const usable = sites.filter((s) => s.permissionLevel !== 'siteUnverifiedUser');

      const projects = await prisma.project.findMany({
        where: { userId: user.id, gscSiteUrl: null },
        select: { id: true, domain: true },
      });

      for (const project of projects) {
        const site = usable.find((s) => siteCoversDomain(s.siteUrl, project.domain));
        if (!site) continue;

        await prisma.project.update({
          where: { id: project.id },
          data: { gscSiteUrl: site.siteUrl, gscAccountId: accountId },
        });
      }
    } catch {
      // No es crítico: el usuario elegirá la propiedad en la UI.
    }

    return back({ gsc: 'connected' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return back({ gsc: 'error', message: message.slice(0, 200) });
  }
}

function hostOf(value: string): string | null {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** ¿Mide esta propiedad (de dominio o de prefijo de URL) el dominio del proyecto? */
function siteCoversDomain(siteUrl: string, projectDomain: string): boolean {
  const projectHost = hostOf(projectDomain);
  if (!projectHost) return false;

  if (siteUrl.startsWith('sc-domain:')) {
    const domain = siteUrl.slice('sc-domain:'.length).toLowerCase();
    return projectHost === domain || projectHost.endsWith(`.${domain}`);
  }

  return hostOf(siteUrl) === projectHost;
}
