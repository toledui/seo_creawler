import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVerifiedUser } from '@/lib/auth';
import { getAppSettings } from '@/lib/settings';
import { exchangeCode, listSites, saveTokens } from '@/src/keywords/gsc-client';

/**
 * Callback OAuth de Google.
 *
 * La autorización se guarda a nivel de cuenta. `state` lleva a dónde
 * volver, y se valida que sea una ruta interna para que un enlace
 * manipulado no pueda usarse como redirección abierta.
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
      const existing = await prisma.gscAccount.findUnique({
        where: { userId: user.id },
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

    await saveTokens(user.id, tokens);

    // Si sólo hay una propiedad, la asignamos a los proyectos que aún no
    // tengan ninguna: así conectar es realmente un solo botón.
    try {
      const sites = await listSites(user.id);
      const usable = sites.filter((s) => s.permissionLevel !== 'siteUnverifiedUser');

      if (usable.length === 1) {
        await prisma.project.updateMany({
          where: { userId: user.id, gscSiteUrl: null },
          data: { gscSiteUrl: usable[0].siteUrl },
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
