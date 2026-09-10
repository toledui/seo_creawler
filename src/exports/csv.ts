import type { Issue, Link, Page } from '@prisma/client';
import { stringify } from 'csv-stringify';
import { Readable } from 'node:stream';
import { prisma } from '../../lib/prisma';

type Row = Record<string, unknown>;

type PageRecord = Page;
type IssueRecord = Issue;
type LinkRecord = Link & {
  sourcePage: { normalizedUrl: string };
  targetPage: { statusCode: number | null } | null;
};

/**
 * Genera un CSV en streaming a partir de un iterador paginado,
 * para no cargar 50.000 filas en memoria (sección 56 del plan).
 */
function csvStream(
  columns: string[],
  pages: () => AsyncGenerator<Row[], void, unknown>,
): ReadableStream<Uint8Array> {
  const stringifier = stringify({ header: true, columns, bom: true });

  const source = Readable.from(
    (async function* () {
      for await (const batch of pages()) {
        for (const row of batch) yield row;
      }
    })(),
    { objectMode: true },
  );

  source.pipe(stringifier);
  source.on('error', (err) => stringifier.destroy(err));

  return Readable.toWeb(stringifier) as ReadableStream<Uint8Array>;
}

const BATCH = 1000;

export function pagesCsv(crawlId: string) {
  const columns = [
    'url',
    'status',
    'contentType',
    'title',
    'titleLength',
    'metaDescription',
    'metaDescriptionLength',
    'h1',
    'h1Count',
    'canonical',
    'metaRobots',
    'indexable',
    'indexabilityReason',
    'wordCount',
    'depth',
    'inlinks',
    'uniqueInlinks',
    'outlinks',
    'externalLinks',
    'internalPageRank',
    'responseTime',
    'inSitemap',
    'potentialOrphan',
    'errorType',
  ];

  return csvStream(columns, async function* () {
    let cursor: bigint | null = null;
    for (;;) {
      const rows: PageRecord[] = await prisma.page.findMany({
        where: { crawlId, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      if (rows.length === 0) return;
      cursor = rows[rows.length - 1].id;
      yield rows.map((p) => ({
        url: p.normalizedUrl,
        status: p.statusCode ?? '',
        contentType: p.contentType ?? '',
        title: p.title ?? '',
        titleLength: p.titleLength ?? '',
        metaDescription: p.metaDescription ?? '',
        metaDescriptionLength: p.metaDescriptionLength ?? '',
        h1: p.h1 ?? '',
        h1Count: p.h1Count,
        canonical: p.canonical ?? '',
        metaRobots: p.metaRobots ?? '',
        indexable: p.indexable ? 'true' : 'false',
        indexabilityReason: p.indexabilityReason,
        wordCount: p.wordCount,
        depth: p.depth,
        inlinks: p.internalInlinks,
        uniqueInlinks: p.uniqueInlinks,
        outlinks: p.internalOutlinks,
        externalLinks: p.externalOutlinks,
        internalPageRank: p.internalPageRank ?? '',
        responseTime: p.responseTime ?? '',
        inSitemap: p.inSitemap ? 'true' : 'false',
        potentialOrphan: p.potentialOrphan ? 'true' : 'false',
        errorType: p.errorType ?? '',
      }));
    }
  });
}

export function linksCsv(crawlId: string, type: 'INTERNAL' | 'EXTERNAL') {
  const columns = [
    'source',
    'target',
    'anchorText',
    'rel',
    'follow',
    'targetStatus',
  ];

  return csvStream(columns, async function* () {
    let cursor: bigint | null = null;
    for (;;) {
      const rows: LinkRecord[] = await prisma.link.findMany({
        where: { crawlId, linkType: type, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: BATCH,
        include: {
          sourcePage: { select: { normalizedUrl: true } },
          targetPage: { select: { statusCode: true } },
        },
      });
      if (rows.length === 0) return;
      cursor = rows[rows.length - 1].id;
      yield rows.map((l) => ({
        source: l.sourcePage.normalizedUrl,
        target: l.targetUrl,
        anchorText: l.anchorText ?? '',
        rel: l.rel ?? '',
        follow: l.follow ? 'true' : 'false',
        targetStatus: l.targetPage?.statusCode ?? '',
      }));
    }
  });
}

export function issuesCsv(crawlId: string) {
  const columns = ['code', 'severity', 'title', 'url', 'details'];

  return csvStream(columns, async function* () {
    let cursor: bigint | null = null;
    for (;;) {
      const rows: IssueRecord[] = await prisma.issue.findMany({
        where: { crawlId, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      if (rows.length === 0) return;
      cursor = rows[rows.length - 1].id;
      yield rows.map((i) => ({
        code: i.code,
        severity: i.severity,
        title: i.title,
        url: i.url ?? '',
        details: i.details ?? '',
      }));
    }
  });
}

export function csvResponse(stream: ReadableStream<Uint8Array>, filename: string) {
  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
