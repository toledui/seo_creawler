import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from './logger';
import { getAppSettings } from './settings';

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

type MailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
};

let cached: { transport: Transporter; signature: string } | null = null;

/**
 * Transporte SMTP construido desde los ajustes del panel de admin, con el
 * `.env` como valor por defecto.
 *
 * Se cachea por firma de configuración: al cambiar los ajustes se crea un
 * transporte nuevo sin reiniciar el servidor.
 */
async function transport(): Promise<Transporter | null> {
  const { smtp } = await getAppSettings();
  if (!smtp.host) return null;

  const signature = [
    smtp.host,
    smtp.port,
    smtp.secure,
    smtp.user ?? '',
    smtp.password ?? '',
  ].join('|');

  if (cached?.signature === signature) return cached.transport;

  const created = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
  });

  cached = { transport: created, signature };
  return created;
}

export async function mailerConfigured(): Promise<boolean> {
  return (await getAppSettings()).smtp.configured;
}

/** Comprueba la conexión SMTP sin enviar nada. */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const mailer = await transport();
  if (!mailer) return { ok: false, error: 'SMTP no configurado' };

  try {
    await mailer.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Envía un correo si hay SMTP configurado.
 *
 * Sin SMTP no falla: deja el aviso en el log, de modo que en desarrollo el
 * flujo se puede completar. Devuelve si llegó a enviarse de verdad.
 */
export async function sendMail(input: MailInput): Promise<boolean> {
  const mailer = await transport();

  if (!mailer) {
    logger.warn(
      { event: 'mail_skipped', to: input.to, subject: input.subject },
      'SMTP no configurado: el correo no se envía',
    );
    return false;
  }

  try {
    const { smtp } = await getAppSettings();
    await mailer.sendMail({
      from: smtp.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments?.map((file) => ({
        filename: file.filename,
        content: file.content,
        contentType: file.contentType ?? 'application/pdf',
      })),
    });
    logger.info({
      event: 'mail_sent',
      to: input.to,
      subject: input.subject,
      attachments: input.attachments?.length ?? 0,
    });
    return true;
  } catch (err) {
    logger.error(
      { event: 'mail_failed', to: input.to, err: String(err) },
      'Fallo enviando correo',
    );
    return false;
  }
}

// ------------------------------------------------------------- Plantillas

const SHELL = (title: string, body: string) => `<!doctype html>
<html lang="es"><body style="margin:0;background:#0b0f14;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#e6edf5">
  <table role="presentation" style="max-width:560px;margin:0 auto;background:#121821;border:1px solid #243040;border-radius:10px">
    <tr><td style="padding:28px">
      <div style="font-size:18px;font-weight:600;margin-bottom:18px">SEO<span style="color:#4f9dff">Crawler</span></div>
      <h1 style="font-size:17px;margin:0 0 14px">${title}</h1>
      ${body}
    </td></tr>
  </table>
</body></html>`;

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#4f9dff;color:#06121f;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">${label}</a>`;

const attached = (filename: string | undefined) =>
  filename
    ? `<p style="font-size:12px;line-height:1.6;color:#8fa0b5;margin:18px 0 0;border-top:1px solid #243040;padding-top:14px">
         Adjunto va el informe completo en PDF (<span style="color:#e6edf5">${filename}</span>).
       </p>`
    : '';

const muted = (text: string) =>
  `<p style="font-size:14px;line-height:1.6;color:#8fa0b5;margin:0 0 20px">${text}</p>`;

export function passwordResetEmail(resetUrl: string, expiresInMinutes = 60) {
  const html = SHELL(
    'Restablecer tu contraseña',
    `${muted(
      `Hemos recibido una solicitud para cambiar la contraseña de tu cuenta. El enlace caduca en ${expiresInMinutes} minutos.`,
    )}
     ${button(resetUrl, 'Elegir nueva contraseña')}
     <p style="font-size:12px;line-height:1.6;color:#8fa0b5;margin:22px 0 0">
       Si no has sido tú, puedes ignorar este correo: tu contraseña no cambiará.
     </p>
     <p style="font-size:11px;color:#5f7288;margin:16px 0 0;word-break:break-all">${resetUrl}</p>`,
  );

  const text = [
    'Restablecer tu contraseña',
    '',
    `Abre este enlace para elegir una nueva contraseña (caduca en ${expiresInMinutes} minutos):`,
    resetUrl,
    '',
    'Si no has sido tú, ignora este correo.',
  ].join('\n');

  return { subject: 'Restablecer tu contraseña · SEO Crawler', html, text };
}

export function invitationEmail(options: {
  inviteUrl: string;
  invitedBy: string | null;
  appUrl: string;
  expiresInHours: number;
}) {
  const html = SHELL(
    'Tu cuenta está lista',
    `${muted(
      `${options.invitedBy ? `${options.invitedBy} te ha dado` : 'Te han dado'} acceso a SEO Crawler. Elige una contraseña para entrar; el enlace caduca en ${options.expiresInHours} horas.`,
    )}
     ${button(options.inviteUrl, 'Establecer mi contraseña')}
     <p style="font-size:12px;line-height:1.6;color:#8fa0b5;margin:22px 0 0">
       Después podrás entrar en ${options.appUrl} con tu email y esa contraseña.
     </p>
     <p style="font-size:11px;color:#5f7288;margin:16px 0 0;word-break:break-all">${options.inviteUrl}</p>`,
  );

  const text = [
    'Tu cuenta de SEO Crawler está lista',
    '',
    `Elige tu contraseña aquí (caduca en ${options.expiresInHours} horas):`,
    options.inviteUrl,
    '',
    `Después entra en ${options.appUrl} con tu email y esa contraseña.`,
  ].join('\n');

  return { subject: 'Acceso a SEO Crawler', html, text };
}

export function crawlReportEmail(options: {
  projectName: string;
  startUrl: string;
  status: string;
  crawledUrls: number;
  indexable: number;
  errors: number;
  seoHealth: number;
  topIssues: { title: string; count: number }[];
  url: string;
  attachmentName?: string;
}) {
  const rows = options.topIssues
    .slice(0, 8)
    .map(
      (issue) =>
        `<tr><td style="padding:4px 0;font-size:13px;color:#e6edf5">${issue.title}</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#8fa0b5">${issue.count}</td></tr>`,
    )
    .join('');

  const stat = (label: string, value: string | number, color = '#e6edf5') =>
    `<td style="padding:8px 12px 8px 0"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8fa0b5">${label}</div><div style="font-size:20px;font-weight:600;color:${color}">${value}</div></td>`;

  const html = SHELL(
    `Crawl terminado · ${options.projectName}`,
    `${muted(`${options.startUrl} — estado ${options.status}`)}
     <table role="presentation" style="margin:0 0 20px"><tr>
       ${stat('URLs', options.crawledUrls.toLocaleString('es-ES'))}
       ${stat('Indexables', options.indexable.toLocaleString('es-ES'), '#3ecf8e')}
       ${stat('Errores', options.errors.toLocaleString('es-ES'), '#ff5c5c')}
       ${stat('SEO Health', `${options.seoHealth}/100`, '#4f9dff')}
     </tr></table>
     ${
       rows
         ? `<p style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#8fa0b5;margin:0 0 6px">Issues principales</p>
            <table role="presentation" style="width:100%;margin:0 0 20px">${rows}</table>`
         : ''
     }
     ${button(options.url, 'Ver el informe completo')}
     ${attached(options.attachmentName)}`,
  );

  const text = [
    `Crawl terminado · ${options.projectName}`,
    options.startUrl,
    '',
    `URLs: ${options.crawledUrls} · Indexables: ${options.indexable} · Errores: ${options.errors} · SEO Health: ${options.seoHealth}/100`,
    '',
    ...options.topIssues.slice(0, 8).map((i) => `- ${i.title}: ${i.count}`),
    '',
    options.url,
    ...(options.attachmentName
      ? ['', `Informe completo adjunto en PDF: ${options.attachmentName}`]
      : []),
  ].join('\n');

  return {
    subject: `Crawl terminado · ${options.projectName} (${options.crawledUrls} URLs)`,
    html,
    text,
  };
}

export function aiReportEmail(options: {
  projectName: string;
  score: number;
  summary: string;
  recommendations: { priority: number; action: string }[];
  url: string;
  model: string;
  attachmentName?: string;
}) {
  const items = options.recommendations
    .slice(0, 10)
    .sort((a, b) => a.priority - b.priority)
    .map(
      (rec) =>
        `<li style="font-size:13px;line-height:1.6;margin-bottom:4px">${rec.action}</li>`,
    )
    .join('');

  const html = SHELL(
    `Auditoría IA · ${options.projectName}`,
    `<div style="margin:0 0 16px"><span style="font-size:32px;font-weight:600;color:#4f9dff">${options.score}</span><span style="font-size:13px;color:#8fa0b5"> /100 score IA</span></div>
     <p style="font-size:14px;line-height:1.6;color:#e6edf5;margin:0 0 20px">${options.summary}</p>
     ${
       items
         ? `<p style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#8fa0b5;margin:0 0 6px">Acciones recomendadas</p>
            <ol style="margin:0 0 20px;padding-left:20px;color:#e6edf5">${items}</ol>`
         : ''
     }
     ${button(options.url, 'Ver la auditoría completa')}
     ${attached(options.attachmentName)}
     <p style="font-size:11px;color:#5f7288;margin:16px 0 0">Generado con ${options.model}</p>`,
  );

  const text = [
    `Auditoría IA · ${options.projectName}`,
    `Score: ${options.score}/100`,
    '',
    options.summary,
    '',
    ...options.recommendations.slice(0, 10).map((r) => `${r.priority}. ${r.action}`),
    '',
    options.url,
    ...(options.attachmentName
      ? ['', `Auditoría completa adjunta en PDF: ${options.attachmentName}`]
      : []),
  ].join('\n');

  return {
    subject: `Auditoría IA · ${options.projectName} (score ${options.score})`,
    html,
    text,
  };
}

export function comparisonReportEmail(options: {
  projectName: string;
  verdict: string;
  scoreDelta: number;
  summary: string;
  resolved: number;
  persisting: number;
  regressions: number;
  nextActions: string[];
  url: string;
  model: string;
  attachmentName?: string;
}) {
  const tone =
    options.verdict === 'MEJORA'
      ? '#3ecf8e'
      : options.verdict === 'EMPEORA'
        ? '#ff5c5c'
        : '#f2c14e';

  const stat = (label: string, value: string | number, color = '#e6edf5') =>
    `<td style="padding:8px 12px 8px 0"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8fa0b5">${label}</div><div style="font-size:20px;font-weight:600;color:${color}">${value}</div></td>`;

  const items = options.nextActions
    .slice(0, 8)
    .map(
      (action) =>
        `<li style="font-size:13px;line-height:1.6;margin-bottom:4px">${action}</li>`,
    )
    .join('');

  const html = SHELL(
    `Comparativa de auditorías · ${options.projectName}`,
    `<div style="margin:0 0 16px"><span style="font-size:26px;font-weight:600;color:${tone}">${options.verdict}</span><span style="font-size:13px;color:#8fa0b5"> · score ${options.scoreDelta > 0 ? '+' : ''}${options.scoreDelta}</span></div>
     <p style="font-size:14px;line-height:1.6;color:#e6edf5;margin:0 0 20px">${options.summary}</p>
     <table role="presentation" style="margin:0 0 20px"><tr>
       ${stat('Resuelto', options.resolved, '#3ecf8e')}
       ${stat('Sigue igual', options.persisting, '#f2c14e')}
       ${stat('Ha empeorado', options.regressions, '#ff5c5c')}
     </tr></table>
     ${
       items
         ? `<p style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#8fa0b5;margin:0 0 6px">Siguientes pasos</p>
            <ol style="margin:0 0 20px;padding-left:20px;color:#e6edf5">${items}</ol>`
         : ''
     }
     ${button(options.url, 'Ver la comparativa completa')}
     ${attached(options.attachmentName)}
     <p style="font-size:11px;color:#5f7288;margin:16px 0 0">Generado con ${options.model}</p>`,
  );

  const text = [
    `Comparativa de auditorías · ${options.projectName}`,
    `Veredicto: ${options.verdict} (score ${options.scoreDelta > 0 ? '+' : ''}${options.scoreDelta})`,
    '',
    options.summary,
    '',
    `Resuelto: ${options.resolved} · Sigue igual: ${options.persisting} · Ha empeorado: ${options.regressions}`,
    '',
    ...options.nextActions.slice(0, 8).map((action, i) => `${i + 1}. ${action}`),
    '',
    options.url,
    ...(options.attachmentName
      ? ['', `Comparativa completa adjunta en PDF: ${options.attachmentName}`]
      : []),
  ].join('\n');

  return {
    subject: `Comparativa de auditorías · ${options.projectName} (${options.verdict})`,
    html,
    text,
  };
}

export function testEmail(appUrl: string) {
  const html = SHELL(
    'Prueba de configuración SMTP',
    `${muted('Si estás leyendo esto, el envío de correo funciona correctamente.')}
     ${button(appUrl, 'Ir a SEO Crawler')}`,
  );

  return {
    subject: 'Prueba de SMTP · SEO Crawler',
    html,
    text: `Si estás leyendo esto, el envío de correo funciona correctamente.\n\n${appUrl}`,
  };
}
