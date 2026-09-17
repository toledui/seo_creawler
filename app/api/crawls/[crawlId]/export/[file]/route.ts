import { prisma } from '@/lib/prisma';
import { assertCrawlOwner, requireUser } from '@/lib/auth';
import { fail, handle } from '@/lib/api';
import {
  csvResponse,
  imagesCsv,
  issuesCsv,
  linksCsv,
  pagesCsv,
} from '@/src/exports/csv';
import { renderCrawlReport } from '@/src/exports/build';
import { isReportFormat } from '@/src/exports/report-renderers';

type Params = { params: Promise<{ crawlId: string; file: string }> };

/**
 * Exportaciones CSV en streaming:
 *   /api/crawls/:id/export/pages.csv
 *   /api/crawls/:id/export/internal-links.csv
 *   /api/crawls/:id/export/external-links.csv
 *   /api/crawls/:id/export/images.csv
 *   /api/crawls/:id/export/issues.csv
 *
 * Y el informe del rastreo maquetado, en los mismos formatos que los
 * informes de IA:
 *   /api/crawls/:id/export/report.pdf | report.docx | report.md
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId, file } = await params;
    await assertCrawlOwner(crawlId, user.id);

    const short = crawlId.slice(0, 8);

    // Cada descarga queda registrada para poder auditar qué se ha sacado.
    const track = async (type: string, filename: string, rows: number) => {
      await prisma.export.create({
        data: { crawlId, type, filename, rows },
      });
    };

    switch (file) {
      case 'pages.csv':
      case 'all-pages.csv': {
        const filename = `pages-${short}.csv`;
        await track('pages', filename, await prisma.page.count({ where: { crawlId } }));
        return csvResponse(pagesCsv(crawlId), filename);
      }

      case 'links.csv':
      case 'internal-links.csv': {
        const filename = `internal-links-${short}.csv`;
        await track(
          'internal-links',
          filename,
          await prisma.link.count({ where: { crawlId, linkType: 'INTERNAL' } }),
        );
        return csvResponse(linksCsv(crawlId, 'INTERNAL'), filename);
      }

      case 'external-links.csv': {
        const filename = `external-links-${short}.csv`;
        await track(
          'external-links',
          filename,
          await prisma.link.count({ where: { crawlId, linkType: 'EXTERNAL' } }),
        );
        return csvResponse(linksCsv(crawlId, 'EXTERNAL'), filename);
      }

      // Informe del rastreo maquetado: report.pdf | report.docx | report.md
      case 'report.pdf':
      case 'report.docx':
      case 'report.md': {
        const format = file.split('.')[1];
        if (!isReportFormat(format)) return fail('Formato no soportado', 422);

        const report = await renderCrawlReport(crawlId, user.id, format);
        if (!report) {
          return fail(
            'El rastreo todavía no tiene métricas: el informe se genera al terminar el análisis.',
            409,
          );
        }

        await prisma.export.create({
          data: {
            crawlId,
            type: `crawl-${format}`,
            filename: report.filename,
            rows: 0,
            bytes: report.body.byteLength,
          },
        });

        return new Response(new Uint8Array(report.body), {
          headers: {
            'content-type': report.contentType,
            'content-disposition': `attachment; filename="${report.filename}"`,
            'content-length': String(report.body.byteLength),
            'cache-control': 'no-store',
          },
        });
      }

      case 'images.csv': {
        const filename = `images-${short}.csv`;
        await track(
          'images',
          filename,
          await prisma.imageAsset.count({ where: { page: { crawlId } } }),
        );
        return csvResponse(imagesCsv(crawlId), filename);
      }

      case 'issues.csv': {
        const filename = `issues-${short}.csv`;
        await track('issues', filename, await prisma.issue.count({ where: { crawlId } }));
        return csvResponse(issuesCsv(crawlId), filename);
      }

      default:
        return fail('Exportación no soportada', 404);
    }
  });
}
