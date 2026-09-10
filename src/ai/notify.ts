import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { getAppSettings, getUserSettings } from '../../lib/settings';
import {
  aiReportEmail,
  comparisonReportEmail,
  crawlReportEmail,
  sendMail,
  type MailAttachment,
} from '../../lib/mailer';
import type { AuditReport } from './prompts/executive-report';
import type { ComparisonReport } from './prompts/compare-reports';
import type { CrawlStats } from '../analysis/analyze-crawl';
import { renderAiReport, renderCrawlReport } from '../exports/build';

/**
 * Envío de informes por correo, siempre con el PDF adjunto.
 *
 * Hay dos interruptores: el global del panel de admin (que apaga los
 * envíos de toda la instancia) y el de cada cuenta. Sólo se envía si
 * ambos están activos y hay SMTP configurado.
 */

export type EmailOptions = {
  /** Destinatario alternativo pedido desde la interfaz. */
  to?: string | null;
  /** Adjuntar el PDF del informe (por defecto sí). */
  attachPdf?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function recipientFor(
  userId: string,
  override?: string | null,
): Promise<string | null> {
  const wanted = override?.trim();
  if (wanted) return EMAIL_RE.test(wanted) ? wanted : null;

  const [settings, user] = await Promise.all([
    getUserSettings(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true },
    }),
  ]);

  if (!user?.isActive) return null;
  return settings.notifyEmail?.trim() || user.email;
}

async function canSend(): Promise<boolean> {
  const app = await getAppSettings();
  return app.smtp.configured && app.email.reportsEnabled;
}

/**
 * Genera el adjunto sin hacer fallar el envío: si el PDF no sale, el
 * correo se manda igualmente con el resumen en el cuerpo.
 */
async function pdfAttachment(
  build: () => Promise<{ filename: string; body: Buffer } | null>,
  context: Record<string, unknown>,
): Promise<MailAttachment | null> {
  try {
    const built = await build();
    if (!built) return null;
    return {
      filename: built.filename,
      content: built.body,
      contentType: 'application/pdf',
    };
  } catch (err) {
    logger.error(
      { event: 'report_pdf_failed', ...context, err: String(err) },
      'No se pudo generar el PDF del informe',
    );
    return null;
  }
}

// ------------------------------------------------------------ Crawl

/** Resumen del crawl al terminar, si la cuenta lo tiene activado. */
export async function maybeEmailCrawlReport(crawlId: string): Promise<boolean> {
  const crawl = await prisma.crawl.findUnique({
    where: { id: crawlId },
    select: { project: { select: { userId: true } } },
  });
  if (!crawl) return false;

  const settings = await getUserSettings(crawl.project.userId);
  if (!settings.emailOnCrawlComplete) return false;

  return emailCrawlReport(crawlId, crawl.project.userId);
}

/** Envío explícito del informe de rastreo (botón "enviar por correo"). */
export async function emailCrawlReport(
  crawlId: string,
  userId: string,
  options: EmailOptions = {},
): Promise<boolean> {
  if (!(await canSend())) return false;

  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, project: { userId } },
    include: { project: { select: { name: true, id: true } } },
  });
  if (!crawl) return false;

  const to = await recipientFor(userId, options.to);
  if (!to) return false;

  const stats = crawl.stats as unknown as CrawlStats | null;
  const app = await getAppSettings();

  const attachment =
    options.attachPdf === false
      ? null
      : await pdfAttachment(() => renderCrawlReport(crawlId, userId), { crawlId });

  const mail = crawlReportEmail({
    projectName: crawl.project.name,
    startUrl: crawl.startUrl,
    status: crawl.status,
    crawledUrls: crawl.crawledUrls,
    indexable: stats?.totals.indexable ?? 0,
    errors: stats?.totals.errors ?? 0,
    seoHealth: stats?.seoHealth ?? 0,
    topIssues: (stats?.topIssues ?? []).map((issue) => ({
      title: issue.title,
      count: issue.count,
    })),
    url: `${app.appUrl}/projects/${crawl.project.id}/crawls/${crawl.id}`,
    attachmentName: attachment?.filename,
  });

  const sent = await sendMail({
    to,
    ...mail,
    attachments: attachment ? [attachment] : undefined,
  });

  logger.info({
    event: 'crawl_report_email',
    crawlId,
    to,
    sent,
    attached: Boolean(attachment),
  });

  return sent;
}

// --------------------------------------------------------------- IA

/** Auditoría de IA recién generada, si la cuenta lo tiene activado. */
export async function maybeEmailAiReport(
  reportId: string,
  userId: string,
): Promise<boolean> {
  const settings = await getUserSettings(userId);
  if (!settings.emailOnAiReport) return false;

  return emailAiReport(reportId, userId);
}

/** Envío explícito, ignorando la preferencia (botón "enviar por correo"). */
export async function emailAiReport(
  reportId: string,
  userId: string,
  options: EmailOptions = {},
): Promise<boolean> {
  if (!(await canSend())) return false;

  const report = await prisma.aiReport.findFirst({
    where: { id: reportId, crawl: { project: { userId } } },
    include: {
      crawl: {
        select: { id: true, projectId: true, project: { select: { name: true } } },
      },
    },
  });

  if (!report?.output) return false;

  const to = await recipientFor(userId, options.to);
  if (!to) return false;

  const app = await getAppSettings();
  const projectName = report.crawl.project.name;

  const attachment =
    options.attachPdf === false
      ? null
      : await pdfAttachment(() => renderAiReport(reportId, userId), { reportId });

  const isComparison = report.type === 'comparison';

  const mail = isComparison
    ? (() => {
        const output = report.output as unknown as ComparisonReport;
        return comparisonReportEmail({
          projectName,
          verdict: output.verdict,
          scoreDelta: output.scoreDelta ?? 0,
          summary: output.summary ?? '',
          resolved: output.resolved?.length ?? 0,
          persisting: output.persisting?.length ?? 0,
          regressions: output.regressions?.length ?? 0,
          nextActions: [...(output.nextActions ?? [])]
            .sort((a, b) => a.priority - b.priority)
            .map((action) => action.action),
          url: `${app.appUrl}/projects/${report.crawl.projectId}/compare`,
          model: report.model,
          attachmentName: attachment?.filename,
        });
      })()
    : (() => {
        const output = report.output as unknown as AuditReport;
        return aiReportEmail({
          projectName,
          score: output.score ?? 0,
          summary: output.summary ?? '',
          recommendations: (output.recommendations ?? []).map((rec) => ({
            priority: rec.priority,
            action: rec.action,
          })),
          url: `${app.appUrl}/projects/${report.crawl.projectId}/crawls/${report.crawl.id}/ai`,
          model: report.model,
          attachmentName: attachment?.filename,
        });
      })();

  const sent = await sendMail({
    to,
    ...mail,
    attachments: attachment ? [attachment] : undefined,
  });

  logger.info({
    event: 'ai_report_email',
    reportId,
    type: report.type,
    to,
    sent,
    attached: Boolean(attachment),
  });

  return sent;
}
