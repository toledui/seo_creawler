import { prisma } from '../../lib/prisma';
import type { AuditReport } from '../ai/prompts/executive-report';
import type { ComparisonReport } from '../ai/prompts/compare-reports';
import type { CrawlStats } from '../analysis/analyze-crawl';
import {
  auditDocument,
  comparisonDocument,
  crawlDocument,
  type ReportDocument,
  type ReportMeta,
} from './report-document';
import { renderReport, type ReportFormat } from './report-renderers';

/**
 * Puente entre la base de datos y los documentos exportables.
 *
 * Tanto la descarga como el envío por correo pasan por aquí, así que el
 * archivo adjunto y el que se descarga salen del mismo sitio.
 */

export type BuiltReport = {
  document: ReportDocument;
  kind: 'audit' | 'comparison' | 'crawl';
  projectId: string;
  crawlId: string;
  projectName: string;
};

export type RenderedReport = BuiltReport & {
  body: Buffer;
  filename: string;
  contentType: string;
};

/** Fechas guardadas en el `input` de una comparación. */
function parseDate(input: unknown, key: string): Date | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Documento de un informe de IA guardado (auditoría o comparativa). */
export async function buildAiReportDocument(
  reportId: string,
  userId: string,
): Promise<BuiltReport | null> {
  const report = await prisma.aiReport.findFirst({
    where: { id: reportId, crawl: { project: { userId } } },
    include: {
      crawl: {
        select: {
          id: true,
          projectId: true,
          startUrl: true,
          crawledUrls: true,
          project: { select: { name: true, domain: true } },
        },
      },
    },
  });

  if (!report?.output) return null;

  const meta: ReportMeta = {
    projectName: report.crawl.project.name,
    domain: report.crawl.project.domain,
    startUrl: report.crawl.startUrl,
    model: report.model,
    createdAt: report.createdAt,
    crawledUrls: report.crawl.crawledUrls,
  };

  const common = {
    projectId: report.crawl.projectId,
    crawlId: report.crawl.id,
    projectName: report.crawl.project.name,
  };

  if (report.type === 'comparison') {
    return {
      ...common,
      kind: 'comparison',
      document: comparisonDocument(
        report.output as unknown as ComparisonReport,
        {
          ...meta,
          beforeDate: parseDate(report.input, 'baseCreatedAt'),
          afterDate: parseDate(report.input, 'targetCreatedAt'),
        },
      ),
    };
  }

  return {
    ...common,
    kind: 'audit',
    document: auditDocument(report.output as unknown as AuditReport, meta),
  };
}

/** Documento del rastreo (métricas, issues, GEO y arquitectura). */
export async function buildCrawlDocument(
  crawlId: string,
  userId: string,
): Promise<BuiltReport | null> {
  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, project: { userId } },
    include: { project: { select: { name: true, domain: true } } },
  });

  const stats = crawl?.stats as unknown as CrawlStats | null;
  if (!crawl || !stats) return null;

  return {
    kind: 'crawl',
    projectId: crawl.projectId,
    crawlId: crawl.id,
    projectName: crawl.project.name,
    document: crawlDocument(stats, {
      projectName: crawl.project.name,
      domain: crawl.project.domain,
      startUrl: crawl.startUrl,
      status: crawl.status,
      crawledUrls: crawl.crawledUrls,
      discoveredUrls: crawl.discoveredUrls,
      failedUrls: crawl.failedUrls,
      startedAt: crawl.startedAt,
      completedAt: crawl.completedAt,
      generatedAt: new Date(),
    }),
  };
}

async function render(
  built: BuiltReport | null,
  format: ReportFormat,
): Promise<RenderedReport | null> {
  if (!built) return null;
  return { ...built, ...(await renderReport(built.document, format)) };
}

/** Informe de IA ya renderizado; por defecto en PDF (el del correo). */
export async function renderAiReport(
  reportId: string,
  userId: string,
  format: ReportFormat = 'pdf',
) {
  return render(await buildAiReportDocument(reportId, userId), format);
}

/** Informe del rastreo ya renderizado. */
export async function renderCrawlReport(
  crawlId: string,
  userId: string,
  format: ReportFormat = 'pdf',
) {
  return render(await buildCrawlDocument(crawlId, userId), format);
}
