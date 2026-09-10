import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { assertProjectOwner } from '@/lib/auth';
import { getAppSettings } from '@/lib/settings';
import { emailAiReport } from '@/src/ai/notify';

type Params = { params: Promise<{ projectId: string; reportId: string }> };

const schema = z.object({
  /** Destinatario alternativo; si falta se usa el de la cuenta. */
  to: z.string().email('Dirección de correo no válida').optional(),
});

export const maxDuration = 120;

/** Envía un informe guardado por correo, con el PDF adjunto. */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId, reportId } = await params;
    await assertProjectOwner(projectId, user.id);

    const settings = await getAppSettings();

    if (!settings.smtp.configured) {
      return fail(
        'No hay SMTP configurado. Pide al administrador que lo configure.',
        409,
      );
    }

    if (!settings.email.reportsEnabled) {
      return fail(
        'El envío de informes está desactivado en la configuración de la instancia.',
        409,
      );
    }

    const body = schema.parse(await request.json().catch(() => ({})));

    const sent = await emailAiReport(reportId, user.id, { to: body.to });
    if (!sent) return fail('No se pudo enviar el informe', 502);

    return ok({ success: true });
  });
}
