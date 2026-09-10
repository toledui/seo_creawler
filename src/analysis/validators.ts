import { prisma } from '../../lib/prisma';
import { normalizeUrl } from '../crawler/normalize-url';
import {
  hammingDistance,
  NEAR_DUPLICATE_THRESHOLD,
  similarityPercent,
} from './simhash';
import { validateSchema } from '../seo/schema-validation';
import {
  validateHreflang,
  type HreflangEntry,
} from '../seo/hreflang-validation';

type IssueRow = {
  crawlId: string;
  pageId: bigint | null;
  url: string | null;
  code: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  details: string | null;
};

async function insertIssues(rows: IssueRow[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.issue.createMany({ data: rows.slice(i, i + 1000) });
  }
}

/**
 * Contenido casi duplicado por SimHash.
 *
 * El duplicado exacto ya lo detecta `contentHash`; esto encuentra el caso
 * frecuente en e-commerce: fichas idénticas salvo el nombre del producto,
 * o páginas de plantilla con dos frases distintas.
 *
 * La comparación es O(n²) sobre las páginas indexables con texto, así que
 * se agrupa primero por los 16 bits altos del simhash (bloqueo por prefijo)
 * para no reventar en crawls grandes.
 */
export async function detectNearDuplicates(crawlId: string): Promise<number> {
  const pages = await prisma.page.findMany({
    where: {
      crawlId,
      indexable: true,
      simhash: { not: null },
      wordCount: { gte: 50 },
    },
    select: { id: true, normalizedUrl: true, simhash: true, contentHash: true },
  });

  if (pages.length < 2) return 0;

  // Bloqueo por prefijo: sólo comparamos dentro del mismo bucket.
  const buckets = new Map<string, typeof pages>();
  for (const page of pages) {
    const key = page.simhash!.slice(0, 3);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(page);
    else buckets.set(key, [page]);
  }

  const reported = new Set<string>();
  const rows: IssueRow[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    // Un bucket degenerado (todo el sitio idéntico) no aporta y sí cuesta.
    const limit = Math.min(bucket.length, 400);

    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const a = bucket[i];
        const b = bucket[j];

        // El duplicado exacto ya tiene su propia regla.
        if (a.contentHash && a.contentHash === b.contentHash) continue;

        const distance = hammingDistance(a.simhash!, b.simhash!);
        if (distance > NEAR_DUPLICATE_THRESHOLD) continue;

        const key = `${a.id}-${b.id}`;
        if (reported.has(key)) continue;
        reported.add(key);

        const similarity = similarityPercent(distance);
        rows.push({
          crawlId,
          pageId: a.id,
          url: a.normalizedUrl.slice(0, 2000),
          code: 'NEAR_DUPLICATE_CONTENT',
          severity: 'MEDIUM',
          title: 'Contenido casi duplicado',
          details: `${similarity}% similar a ${b.normalizedUrl}`,
        });
      }
    }
  }

  await insertIssues(rows);
  return rows.length;
}

/** Valida el JSON-LD de todas las páginas del crawl. */
export async function validateStructuredData(crawlId: string): Promise<number> {
  const rows: IssueRow[] = [];
  let cursor: bigint | null = null;

  for (;;) {
    const schemas: {
      id: bigint;
      pageId: bigint;
      schemaType: string | null;
      rawJson: string;
      validJson: boolean;
      page: { normalizedUrl: string };
    }[] = await prisma.schemaMarkup.findMany({
      where: {
        page: { crawlId },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 500,
      select: {
        id: true,
        pageId: true,
        schemaType: true,
        rawJson: true,
        validJson: true,
        page: { select: { normalizedUrl: true } },
      },
    });

    if (schemas.length === 0) break;
    cursor = schemas[schemas.length - 1].id;

    for (const schema of schemas) {
      const url = schema.page.normalizedUrl.slice(0, 2000);

      if (!schema.validJson) {
        rows.push({
          crawlId,
          pageId: schema.pageId,
          url,
          code: 'SCHEMA_INVALID_JSON',
          severity: 'MEDIUM',
          title: 'JSON-LD inválido',
          details: 'El bloque application/ld+json no es JSON parseable',
        });
        continue;
      }

      for (const problem of validateSchema(schema.schemaType, schema.rawJson)) {
        rows.push({
          crawlId,
          pageId: schema.pageId,
          url,
          code:
            problem.kind === 'REQUIRED'
              ? 'SCHEMA_MISSING_REQUIRED'
              : 'SCHEMA_MISSING_RECOMMENDED',
          severity: problem.severity,
          title:
            problem.kind === 'REQUIRED'
              ? 'Schema sin propiedades obligatorias'
              : 'Schema sin propiedades recomendadas',
          details: `${problem.schemaType}: falta ${problem.missing.join(', ')}`,
        });
      }
    }
  }

  await insertIssues(rows);
  return rows.length;
}

const HREFLANG_TITLES: Record<string, { title: string; severity: IssueRow['severity'] }> = {
  HREFLANG_INVALID_CODE: { title: 'Código hreflang inválido', severity: 'MEDIUM' },
  HREFLANG_MISSING_SELF: { title: 'Hreflang sin auto-referencia', severity: 'MEDIUM' },
  HREFLANG_BROKEN_TARGET: { title: 'Destino hreflang roto', severity: 'HIGH' },
  HREFLANG_NOT_RECIPROCAL: { title: 'Hreflang sin reciprocidad', severity: 'MEDIUM' },
};

/** Valida los conjuntos hreflang del crawl completo. */
export async function validateHreflangSets(crawlId: string): Promise<number> {
  const pages = await prisma.page.findMany({
    where: { crawlId, hreflangs: { some: {} } },
    select: {
      id: true,
      normalizedUrl: true,
      hreflangs: { select: { href: true, language: true } },
    },
  });

  if (pages.length === 0) return 0;

  // Necesitamos el status de los destinos y sus propios hreflang.
  const statusRows = await prisma.page.findMany({
    where: { crawlId },
    select: { normalizedUrl: true, statusCode: true },
  });
  const statusByUrl = new Map(
    statusRows.map((p) => [p.normalizedUrl, p.statusCode]),
  );

  const entriesByUrl = new Map<string, HreflangEntry[]>(
    pages.map((p) => [p.normalizedUrl, p.hreflangs]),
  );

  const normalize = (url: string) => normalizeUrl(url);
  const rows: IssueRow[] = [];

  for (const page of pages) {
    const problems = validateHreflang({
      pageUrl: page.normalizedUrl,
      entries: page.hreflangs,
      statusByUrl,
      entriesByUrl,
      normalize,
    });

    for (const problem of problems) {
      const meta = HREFLANG_TITLES[problem.code];
      rows.push({
        crawlId,
        pageId: page.id,
        url: page.normalizedUrl.slice(0, 2000),
        code: problem.code,
        severity: meta.severity,
        title: meta.title,
        details: problem.detail,
      });
    }
  }

  await insertIssues(rows);
  return rows.length;
}
