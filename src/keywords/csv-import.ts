import { parse } from 'csv-parse/sync';
import { prisma } from '../../lib/prisma';
import {
  isValidKeyword,
  normalizeCountry,
  normalizeDevice,
  normalizeKeyword,
} from './normalize';

export type ImportResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

/**
 * Alias de columna por campo.
 *
 * Cubre las exportaciones habituales: Search Console (en inglés y en
 * español), Ahrefs, Semrush y CSV hechos a mano.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  keyword: [
    'keyword', 'keywords', 'query', 'consulta', 'consultas',
    'palabra clave', 'palabras clave', 'term', 'search term', 'búsqueda',
  ],
  position: [
    'position', 'posicion', 'posición', 'avg position', 'average position',
    'posición media', 'posicion media', 'rank', 'ranking', 'pos',
  ],
  clicks: ['clicks', 'clics', 'clicks totales', 'total clicks'],
  impressions: [
    'impressions', 'impresiones', 'impressions totales', 'total impressions',
    'impr', 'impr.',
  ],
  ctr: ['ctr', 'click through rate', 'ctr medio', 'average ctr'],
  url: ['url', 'page', 'página', 'pagina', 'landing page', 'destino', 'target url'],
  country: ['country', 'país', 'pais', 'location', 'mercado'],
  device: ['device', 'dispositivo'],
  date: ['date', 'fecha', 'day', 'día'],
  tags: ['tags', 'etiquetas', 'grupo', 'group', 'categoría', 'categoria'],
};

function buildColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};

  headers.forEach((header, index) => {
    const clean = header
      .replace(/^﻿/, '')
      .trim()
      .toLowerCase();

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.includes(clean)) map[field] = index;
    }
  });

  return map;
}

/** "12,5%", "0.125", "12.5" -> 0.125 */
function parseCtr(value: string | undefined): number | null {
  if (!value) return null;
  const clean = value.replace('%', '').replace(',', '.').trim();
  const n = Number(clean);
  if (!Number.isFinite(n)) return null;
  return value.includes('%') || n > 1 ? n / 100 : n;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const clean = value.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();

  // dd/mm/yyyy
  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

const MAX_ROWS = 50_000;

/**
 * Importa keywords desde un CSV.
 *
 * Detecta las columnas por nombre, así que sirve tanto un export directo
 * de Search Console como una lista con una sola columna de keywords.
 * Si el CSV trae posición/clics/impresiones, se guarda además como
 * histórico del día indicado (o de hoy si no hay columna de fecha).
 */
export async function importKeywordsCsv(
  projectId: string,
  content: string,
  filename?: string,
): Promise<ImportResult> {
  const result: ImportResult = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const importRecord = await prisma.keywordImport.create({
    data: {
      projectId,
      source: 'CSV',
      filename: filename?.slice(0, 190) ?? null,
      status: 'RUNNING',
    },
  });

  try {
    let rows: string[][];
    try {
      rows = parse(content, {
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        bom: true,
        // Search Console exporta con coma; otras herramientas con punto y coma.
        delimiter: [',', ';', '\t'],
      }) as string[][];
    } catch (err) {
      throw new Error(`CSV ilegible: ${(err as Error).message}`);
    }

    if (rows.length === 0) throw new Error('El archivo está vacío');

    const columns = buildColumnMap(rows[0]);
    let dataRows = rows.slice(1);

    // Sin cabecera reconocible asumimos una única columna de keywords.
    if (columns.keyword === undefined) {
      columns.keyword = 0;
      dataRows = rows;
    }

    if (dataRows.length > MAX_ROWS) {
      result.errors.push(
        `El archivo tiene ${dataRows.length} filas; sólo se procesan las primeras ${MAX_ROWS}`,
      );
      dataRows = dataRows.slice(0, MAX_ROWS);
    }

    result.total = dataRows.length;

    const today = startOfUtcDay(new Date());

    for (const row of dataRows) {
      const rawKeyword = row[columns.keyword];
      if (!rawKeyword || !isValidKeyword(rawKeyword)) {
        result.skipped++;
        continue;
      }

      const keyword = rawKeyword.trim().slice(0, 255);
      const normalized = normalizeKeyword(keyword);
      const country = normalizeCountry(
        columns.country !== undefined ? row[columns.country] : undefined,
      );
      const device = normalizeDevice(
        columns.device !== undefined ? row[columns.device] : undefined,
      );

      const position =
        columns.position !== undefined ? parseNumber(row[columns.position]) : null;
      const clicks =
        columns.clicks !== undefined ? parseNumber(row[columns.clicks]) : null;
      const impressions =
        columns.impressions !== undefined
          ? parseNumber(row[columns.impressions])
          : null;
      const ctr = columns.ctr !== undefined ? parseCtr(row[columns.ctr]) : null;
      const url = columns.url !== undefined ? row[columns.url]?.trim() || null : null;
      const tags =
        columns.tags !== undefined ? row[columns.tags]?.trim() || null : null;
      const date =
        (columns.date !== undefined ? parseDate(row[columns.date]) : null) ?? today;

      const existing = await prisma.keyword.findUnique({
        where: {
          projectId_normalized_country_device: {
            projectId,
            normalized,
            country,
            device,
          },
        },
        select: { id: true, bestPosition: true, lastPosition: true },
      });

      const metrics = {
        lastPosition: position ?? undefined,
        lastClicks: clicks != null ? Math.round(clicks) : undefined,
        lastImpressions: impressions != null ? Math.round(impressions) : undefined,
        lastCtr: ctr ?? undefined,
        lastUrl: url ?? undefined,
        lastCheckedAt: position != null ? date : undefined,
      };

      let keywordId: bigint;

      if (existing) {
        const best =
          position != null
            ? Math.min(position, existing.bestPosition ?? Number.POSITIVE_INFINITY)
            : existing.bestPosition;

        await prisma.keyword.update({
          where: { id: existing.id },
          data: {
            keyword,
            targetUrl: url ?? undefined,
            tags: tags ?? undefined,
            ...metrics,
            previousPosition: position != null ? existing.lastPosition : undefined,
            bestPosition: best ?? undefined,
          },
        });
        keywordId = existing.id;
        result.updated++;
      } else {
        const created = await prisma.keyword.create({
          data: {
            projectId,
            keyword,
            normalized,
            country,
            device,
            source: 'CSV',
            tags,
            targetUrl: url,
            bestPosition: position,
            ...metrics,
          },
          select: { id: true },
        });
        keywordId = created.id;
        result.created++;
      }

      // Sólo guardamos histórico si el CSV trae métricas reales.
      if (position != null || clicks != null || impressions != null) {
        await prisma.keywordRanking.upsert({
          where: { keywordId_date: { keywordId, date: startOfUtcDay(date) } },
          create: {
            keywordId,
            date: startOfUtcDay(date),
            position,
            clicks: clicks != null ? Math.round(clicks) : 0,
            impressions: impressions != null ? Math.round(impressions) : 0,
            ctr: ctr ?? 0,
            url,
            source: 'CSV',
          },
          update: {
            position,
            clicks: clicks != null ? Math.round(clicks) : 0,
            impressions: impressions != null ? Math.round(impressions) : 0,
            ctr: ctr ?? 0,
            url,
            source: 'CSV',
          },
        });
      }
    }

    await prisma.keywordImport.update({
      where: { id: importRecord.id },
      data: {
        status: 'COMPLETED',
        totalRows: result.total,
        createdRows: result.created,
        updatedRows: result.updated,
        skippedRows: result.skipped,
        error: result.errors.length ? result.errors.join(' · ') : null,
        finishedAt: new Date(),
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.keywordImport.update({
      where: { id: importRecord.id },
      data: { status: 'FAILED', error: message.slice(0, 2000), finishedAt: new Date() },
    });
    throw err;
  }
}
