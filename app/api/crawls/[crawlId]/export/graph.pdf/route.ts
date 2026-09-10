import { z } from 'zod';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import { assertCrawlOwner, requireUser } from '@/lib/auth';
import { fail, handle } from '@/lib/api';

type Params = { params: Promise<{ crawlId: string }> };

const schema = z.object({
  /** PNG del grafo en base64, generado en el cliente. */
  png: z.string().min(100),
  title: z.string().max(200).default('Arquitectura del sitio'),
  subtitle: z.string().max(300).optional(),
});

const MAX_PNG_BYTES = 20 * 1024 * 1024;

/**
 * Genera el PDF del grafo.
 *
 * El render vive en el cliente (Sigma/SVG), así que la imagen llega ya
 * rasterizada y aquí sólo la componemos con cabecera y metadatos.
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    const crawl = await assertCrawlOwner(crawlId, user.id);

    const body = schema.parse(await request.json());
    const bytes = Buffer.from(body.png, 'base64');

    if (bytes.length > MAX_PNG_BYTES) {
      return fail('La imagen del grafo es demasiado grande', 413);
    }

    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(bytes);

    const margin = 36;
    const headerHeight = 64;

    // Página a medida de la imagen, con un ancho mínimo legible.
    const contentWidth = Math.max(image.width, 700);
    const pageWidth = contentWidth + margin * 2;
    const pageHeight = image.height + margin * 2 + headerHeight;

    const page = pdf.addPage([pageWidth, pageHeight]);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const regular = await pdf.embedFont(StandardFonts.Helvetica);

    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: rgb(0.043, 0.059, 0.078),
    });

    page.drawText(body.title, {
      x: margin,
      y: pageHeight - margin - 14,
      size: 16,
      font: bold,
      color: rgb(0.902, 0.929, 0.961),
    });

    const meta = [
      crawl.project.name,
      crawl.startUrl,
      body.subtitle,
      new Date().toLocaleString('es-ES'),
    ]
      .filter(Boolean)
      .join('  ·  ');

    page.drawText(meta.slice(0, 200), {
      x: margin,
      y: pageHeight - margin - 34,
      size: 9,
      font: regular,
      color: rgb(0.561, 0.627, 0.71),
    });

    page.drawImage(image, {
      x: margin + (contentWidth - image.width) / 2,
      y: margin,
      width: image.width,
      height: image.height,
    });

    pdf.setTitle(body.title);
    pdf.setSubject(`Crawl ${crawlId}`);
    pdf.setCreator('SEO Crawler');

    const output = await pdf.save();
    const filename = `site-graph-${crawlId.slice(0, 8)}.pdf`;

    await prisma.export.create({
      data: {
        crawlId,
        type: 'graph-pdf',
        filename,
        rows: 0,
        bytes: output.byteLength,
      },
    });

    return new Response(Buffer.from(output), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  });
}
