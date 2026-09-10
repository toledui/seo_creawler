import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Block, ReportDocument } from './report-document';

// ------------------------------------------------------------- Markdown

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Markdown estándar: se lee tal cual y se pega en Notion, Docs o un issue. */
export function renderMarkdown(doc: ReportDocument): string {
  const lines: string[] = [`# ${doc.title}`, '', `_${doc.subtitle}_`, ''];

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading':
        lines.push(`${'#'.repeat(block.level + 1)} ${block.text}`, '');
        break;

      case 'paragraph':
        lines.push(block.text, '');
        break;

      case 'bullets':
        lines.push(...block.items.map((item) => `- ${item}`), '');
        break;

      case 'numbered':
        lines.push(...block.items.map((item, i) => `${i + 1}. ${item}`), '');
        break;

      case 'facts':
        lines.push(
          ...block.items.map((item) => `**${item.label}:** ${item.value}`),
          '',
        );
        break;

      case 'table':
        lines.push(
          `| ${block.headers.join(' | ')} |`,
          `| ${block.headers.map(() => '---').join(' | ')} |`,
          ...block.rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
          '',
        );
        break;

      case 'divider':
        lines.push('---', '');
        break;
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ------------------------------------------------------------------ PDF

/**
 * Las fuentes estándar de PDF usan WinAnsi, que cubre el español pero no
 * flechas ni viñetas tipográficas. Sustituimos lo habitual y descartamos
 * el resto para que `drawText` no reviente a mitad del informe.
 */
function toWinAnsi(value: string): string {
  return value
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/↔/g, '<->')
    .replace(/[•●▪]/g, '-')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    // Todo lo que quede fuera de WinAnsi se descarta.
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
}

const PAGE = { width: 595.28, height: 841.89 }; // A4
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

type PdfContext = {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  pageNumber: number;
};

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    // Una palabra sola más ancha que la caja (una URL larga): se parte.
    if (font.widthOfTextAtSize(word, size) > width) {
      let chunk = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > width) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    } else {
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function newPage(ctx: PdfContext) {
  ctx.page = ctx.pdf.addPage([PAGE.width, PAGE.height]);
  ctx.pageNumber++;
  ctx.y = PAGE.height - MARGIN;
}

function ensureSpace(ctx: PdfContext, needed: number) {
  if (ctx.y - needed < MARGIN + 24) newPage(ctx);
}

function drawLines(
  ctx: PdfContext,
  lines: string[],
  options: {
    font: PDFFont;
    size: number;
    color?: ReturnType<typeof rgb>;
    leading?: number;
    indent?: number;
  },
) {
  const leading = options.leading ?? options.size * 1.45;

  for (const line of lines) {
    ensureSpace(ctx, leading);
    ctx.page.drawText(line, {
      x: MARGIN + (options.indent ?? 0),
      y: ctx.y - options.size,
      size: options.size,
      font: options.font,
      color: options.color ?? rgb(0.12, 0.14, 0.18),
    });
    ctx.y -= leading;
  }
}

function drawTable(ctx: PdfContext, block: Extract<Block, { type: 'table' }>) {
  const size = 8.5;
  const padding = 5;
  const columns = block.headers.length;

  // Reparto de anchos: la segunda columna suele ser la acción y necesita más.
  const weights = block.headers.map((_, i) =>
    columns >= 4 ? (i === 0 ? 0.5 : i === 1 ? 1.8 : 1) : i === 0 ? 1.6 : 1,
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / totalWeight) * CONTENT_WIDTH);

  const drawRow = (cells: string[], bold: boolean) => {
    const font = bold ? ctx.bold : ctx.regular;
    const wrapped = cells.map((cell, i) =>
      wrap(cell, font, size, widths[i] - padding * 2),
    );
    const height = Math.max(...wrapped.map((w) => w.length)) * (size * 1.35) + padding * 2;

    ensureSpace(ctx, height);

    if (bold) {
      ctx.page.drawRectangle({
        x: MARGIN,
        y: ctx.y - height,
        width: CONTENT_WIDTH,
        height,
        color: rgb(0.93, 0.95, 0.97),
      });
    }

    let x = MARGIN;
    wrapped.forEach((cellLines, i) => {
      cellLines.forEach((line, lineIndex) => {
        ctx.page.drawText(line, {
          x: x + padding,
          y: ctx.y - padding - size - lineIndex * (size * 1.35),
          size,
          font,
          color: rgb(0.12, 0.14, 0.18),
        });
      });
      x += widths[i];
    });

    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y - height },
      end: { x: MARGIN + CONTENT_WIDTH, y: ctx.y - height },
      thickness: 0.5,
      color: rgb(0.82, 0.85, 0.89),
    });

    ctx.y -= height;
  };

  drawRow(block.headers, true);
  for (const row of block.rows) drawRow(row, false);
  ctx.y -= 8;
}

export async function renderPdf(doc: ReportDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ctx: PdfContext = {
    pdf,
    page: pdf.addPage([PAGE.width, PAGE.height]),
    y: PAGE.height - MARGIN,
    regular,
    bold,
    pageNumber: 1,
  };

  // ---- Portada
  drawLines(ctx, wrap(doc.title, bold, 20, CONTENT_WIDTH), {
    font: bold,
    size: 20,
    color: rgb(0.06, 0.1, 0.16),
  });
  ctx.y -= 4;
  drawLines(ctx, wrap(doc.subtitle, regular, 10, CONTENT_WIDTH), {
    font: regular,
    size: 10,
    color: rgb(0.42, 0.47, 0.54),
  });
  ctx.y -= 12;

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading': {
        const size = block.level === 2 ? 14 : 11;
        ctx.y -= block.level === 2 ? 12 : 8;
        ensureSpace(ctx, size * 2);
        drawLines(ctx, wrap(block.text, bold, size, CONTENT_WIDTH), {
          font: bold,
          size,
          color: rgb(0.06, 0.1, 0.16),
        });
        ctx.y -= 2;
        break;
      }

      case 'paragraph':
        drawLines(ctx, wrap(block.text, regular, 10, CONTENT_WIDTH), {
          font: regular,
          size: 10,
        });
        ctx.y -= 5;
        break;

      case 'bullets':
        for (const item of block.items) {
          const lines = wrap(item, regular, 10, CONTENT_WIDTH - 14);
          drawLines(ctx, [`- ${lines[0]}`], { font: regular, size: 10 });
          if (lines.length > 1) {
            drawLines(ctx, lines.slice(1), { font: regular, size: 10, indent: 14 });
          }
        }
        ctx.y -= 5;
        break;

      case 'numbered':
        block.items.forEach((item, i) => {
          const lines = wrap(item, regular, 10, CONTENT_WIDTH - 20);
          drawLines(ctx, [`${i + 1}. ${lines[0]}`], { font: regular, size: 10 });
          if (lines.length > 1) {
            drawLines(ctx, lines.slice(1), { font: regular, size: 10, indent: 20 });
          }
        });
        ctx.y -= 5;
        break;

      case 'facts':
        for (const item of block.items) {
          ensureSpace(ctx, 15);
          ctx.page.drawText(toWinAnsi(`${item.label}:`), {
            x: MARGIN,
            y: ctx.y - 10,
            size: 10,
            font: bold,
            color: rgb(0.42, 0.47, 0.54),
          });
          ctx.page.drawText(toWinAnsi(item.value), {
            x: MARGIN + 120,
            y: ctx.y - 10,
            size: 10,
            font: regular,
            color: rgb(0.12, 0.14, 0.18),
          });
          ctx.y -= 15;
        }
        ctx.y -= 5;
        break;

      case 'table':
        drawTable(ctx, block);
        break;

      case 'divider':
        ensureSpace(ctx, 14);
        ctx.page.drawLine({
          start: { x: MARGIN, y: ctx.y - 6 },
          end: { x: MARGIN + CONTENT_WIDTH, y: ctx.y - 6 },
          thickness: 0.75,
          color: rgb(0.82, 0.85, 0.89),
        });
        ctx.y -= 16;
        break;
    }
  }

  // ---- Numeración al pie
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    page.drawText(`${index + 1} / ${pages.length}`, {
      x: PAGE.width - MARGIN - 40,
      y: MARGIN - 20,
      size: 8,
      font: regular,
      color: rgb(0.6, 0.64, 0.7),
    });
  });

  pdf.setTitle(doc.title);
  pdf.setCreator('SEO Crawler');

  return pdf.save();
}

// ----------------------------------------------------------------- Word

export async function renderDocx(doc: ReportDocument): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: doc.subtitle, italics: true, color: '6B7280' })],
      spacing: { after: 240 },
    }),
  ];

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading':
        children.push(
          new Paragraph({
            text: block.text,
            heading:
              block.level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
          }),
        );
        break;

      case 'paragraph':
        children.push(
          new Paragraph({ text: block.text, spacing: { after: 120 } }),
        );
        break;

      case 'bullets':
        for (const item of block.items) {
          children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
        }
        break;

      case 'numbered':
        block.items.forEach((item, i) => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${i + 1}. `, bold: true }),
                new TextRun(item),
              ],
              spacing: { after: 60 },
            }),
          );
        });
        break;

      case 'facts':
        for (const item of block.items) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${item.label}: `, bold: true }),
                new TextRun(item.value),
              ],
              spacing: { after: 40 },
            }),
          );
        }
        break;

      case 'table':
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: block.headers.map(
                  (header) =>
                    new TableCell({
                      shading: { fill: 'EEF2F6' },
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: header, bold: true })],
                        }),
                      ],
                    }),
                ),
              }),
              ...block.rows.map(
                (row) =>
                  new TableRow({
                    children: row.map(
                      (cell) =>
                        new TableCell({
                          children: [new Paragraph({ text: cell })],
                        }),
                    ),
                  }),
              ),
            ],
          }),
        );
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
        break;

      case 'divider':
        children.push(
          new Paragraph({
            border: {
              bottom: { style: 'single', size: 6, color: 'D1D5DB', space: 1 },
            },
            spacing: { after: 240 },
          }),
        );
        break;
    }
  }

  const document = new Document({
    creator: 'SEO Crawler',
    title: doc.title,
    sections: [
      {
        properties: {},
        children,
        footers: undefined,
      },
    ],
  });

  return Packer.toBuffer(document);
}

// --------------------------------------------------------------- Formatos

export const REPORT_FORMATS = {
  md: {
    extension: 'md',
    contentType: 'text/markdown; charset=utf-8',
    label: 'Markdown',
  },
  pdf: {
    extension: 'pdf',
    contentType: 'application/pdf',
    label: 'PDF',
  },
  docx: {
    extension: 'docx',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word',
  },
} as const;

export type ReportFormat = keyof typeof REPORT_FORMATS;

export function isReportFormat(value: string): value is ReportFormat {
  return value in REPORT_FORMATS;
}

/** Genera el archivo en el formato pedido. */
export async function renderReport(
  doc: ReportDocument,
  format: ReportFormat,
): Promise<{ body: Buffer; filename: string; contentType: string }> {
  const spec = REPORT_FORMATS[format];
  const filename = `${doc.filename}.${spec.extension}`;

  if (format === 'md') {
    return {
      body: Buffer.from(renderMarkdown(doc), 'utf8'),
      filename,
      contentType: spec.contentType,
    };
  }

  if (format === 'pdf') {
    return {
      body: Buffer.from(await renderPdf(doc)),
      filename,
      contentType: spec.contentType,
    };
  }

  return {
    body: await renderDocx(doc),
    filename,
    contentType: spec.contentType,
  };
}
