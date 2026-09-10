import { prisma } from '@/lib/prisma';
import { assertProjectOwner, requireUser } from '@/lib/auth';
import { fail, handle } from '@/lib/api';
import {
  auditDocument,
  comparisonDocument,
  type ReportMeta,
} from '@/src/exports/report-document';
import {
  isReportFormat,
  renderReport,
  REPORT_FORMATS,
} from '@/src/exports/report-renderers';
import type { AuditReport } from '@/src/ai/prompts/executive-report';
import type { ComparisonReport } from '@/src/ai/prompts/compare-reports';

type Params = { params: Promise<{ projectId: string; reportId: string }> };

/**
 * Descarga un informe de IA en Markdown, PDF o Word.
 *
 * Los tres formatos salen del mismo modelo de documento, así que el
 * contenido es idéntico y sólo cambia la maquetación.
 */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId, reportId } = await params;
    const project = await assertProjectOwner(projectId, user.id);

    const format = new URL(request.url).searchParams.get('format') ?? 'pdf';
    if (!isReportFormat(format)) {
      return fail(
        `Formato no soportado. Usa: ${Object.keys(REPORT_FORMATS).join(', ')}`,
        422,
      );
    }

    const report = await prisma.aiReport.findFirst({
      where: { id: reportId, crawl: { projectId } },
      include: {
        crawl: { select: { startUrl: true, crawledUrls: true } },
      },
    });

    if (!report) return fail('Informe no encontrado', 404);
    if (!report.output) {
      return fail('Este informe no tiene contenido descargable', 409);
    }

    const meta: ReportMeta = {
      projectName: project.name,
      domain: project.domain,
      startUrl: report.crawl.startUrl,
      model: report.model,
      createdAt: report.createdAt,
      crawledUrls: report.crawl.crawledUrls,
    };

    const doc =
      report.type === 'comparison'
        ? comparisonDocument(report.output as unknown as ComparisonReport, {
            ...meta,
            beforeDate: parseDate(report.input, 'baseCreatedAt'),
            afterDate: parseDate(report.input, 'targetCreatedAt'),
          })
        : auditDocument(report.output as unknown as AuditReport, meta);

    const file = await renderReport(doc, format);

    await prisma.export.create({
      data: {
        crawlId: report.crawlId,
        type: `ai-${report.type}-${format}`,
        filename: file.filename,
        bytes: file.body.byteLength,
      },
    });

    return new Response(new Uint8Array(file.body), {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="${file.filename}"`,
        'content-length': String(file.body.byteLength),
        'cache-control': 'no-store',
      },
    });
  });
}

/** Fechas guardadas en el `input` de una comparación. */
function parseDate(input: unknown, key: string): Date | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
