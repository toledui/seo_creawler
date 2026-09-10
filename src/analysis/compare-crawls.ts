import { prisma } from '../../lib/prisma';
import type { CrawlStats } from './analyze-crawl';

export type MetricDelta = {
  label: string;
  before: number;
  after: number;
  delta: number;
  /** true si subir es bueno (indexables), false si subir es malo (errores). */
  higherIsBetter: boolean;
};

export type UrlChange = {
  url: string;
  pageId: string | null;
  before: number | null;
  after: number | null;
  detail?: string;
};

export type CrawlComparison = {
  base: { id: string; startUrl: string; completedAt: string | null; pages: number };
  target: { id: string; startUrl: string; completedAt: string | null; pages: number };
  metrics: MetricDelta[];
  addedUrls: UrlChange[];
  removedUrls: UrlChange[];
  statusChanges: UrlChange[];
  indexabilityChanges: UrlChange[];
  issueDeltas: {
    code: string;
    title: string;
    severity: string;
    before: number;
    after: number;
    delta: number;
  }[];
  counts: {
    added: number;
    removed: number;
    statusChanged: number;
    indexabilityChanged: number;
  };
};

const SAMPLE = 100;

function metric(
  label: string,
  before: number,
  after: number,
  higherIsBetter: boolean,
): MetricDelta {
  return { label, before, after, delta: after - before, higherIsBetter };
}

/**
 * Compara dos crawls del mismo proyecto.
 *
 * Responde a "¿qué ha cambiado desde la última auditoría?": URLs que
 * aparecen o desaparecen, páginas que se rompen o se arreglan, cambios de
 * indexabilidad y evolución de cada tipo de issue.
 */
export async function compareCrawls(
  baseId: string,
  targetId: string,
): Promise<CrawlComparison> {
  const [base, target] = await Promise.all([
    prisma.crawl.findUnique({ where: { id: baseId } }),
    prisma.crawl.findUnique({ where: { id: targetId } }),
  ]);

  if (!base || !target) throw new Error('Crawl no encontrado');
  if (base.projectId !== target.projectId) {
    throw new Error('Los crawls pertenecen a proyectos distintos');
  }

  const baseStats = base.stats as unknown as CrawlStats | null;
  const targetStats = target.stats as unknown as CrawlStats | null;

  // ---- URLs que aparecen y desaparecen (comparación por urlHash en SQL)
  const [added, removed, statusChanges, indexabilityChanges] = await Promise.all([
    prisma.$queryRaw<{ url: string; id: bigint; status: number | null }[]>`
      SELECT t.normalizedUrl AS url, t.id, t.statusCode AS status
        FROM Page t
        LEFT JOIN Page b ON b.crawlId = ${baseId} AND b.urlHash = t.urlHash
       WHERE t.crawlId = ${targetId} AND b.id IS NULL
       ORDER BY t.internalPageRank DESC
       LIMIT ${SAMPLE}`,
    prisma.$queryRaw<{ url: string; id: bigint; status: number | null }[]>`
      SELECT b.normalizedUrl AS url, b.id, b.statusCode AS status
        FROM Page b
        LEFT JOIN Page t ON t.crawlId = ${targetId} AND t.urlHash = b.urlHash
       WHERE b.crawlId = ${baseId} AND t.id IS NULL
       ORDER BY b.internalPageRank DESC
       LIMIT ${SAMPLE}`,
    prisma.$queryRaw<
      { url: string; id: bigint; before: number | null; after: number | null }[]
    >`
      SELECT t.normalizedUrl AS url, t.id,
             b.statusCode AS \`before\`, t.statusCode AS \`after\`
        FROM Page t
        JOIN Page b ON b.crawlId = ${baseId} AND b.urlHash = t.urlHash
       WHERE t.crawlId = ${targetId}
         AND NOT (t.statusCode <=> b.statusCode)
       ORDER BY t.internalPageRank DESC
       LIMIT ${SAMPLE}`,
    prisma.$queryRaw<
      { url: string; id: bigint; beforeReason: string; afterReason: string }[]
    >`
      SELECT t.normalizedUrl AS url, t.id,
             b.indexabilityReason AS beforeReason,
             t.indexabilityReason AS afterReason
        FROM Page t
        JOIN Page b ON b.crawlId = ${baseId} AND b.urlHash = t.urlHash
       WHERE t.crawlId = ${targetId}
         AND t.indexabilityReason <> b.indexabilityReason
       ORDER BY t.internalPageRank DESC
       LIMIT ${SAMPLE}`,
  ]);

  const [addedCount, removedCount, statusCount, indexCount] = await Promise.all([
    prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM Page t
       LEFT JOIN Page b ON b.crawlId = ${baseId} AND b.urlHash = t.urlHash
       WHERE t.crawlId = ${targetId} AND b.id IS NULL`,
    prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM Page b
       LEFT JOIN Page t ON t.crawlId = ${targetId} AND t.urlHash = b.urlHash
       WHERE b.crawlId = ${baseId} AND t.id IS NULL`,
    prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM Page t
       JOIN Page b ON b.crawlId = ${baseId} AND b.urlHash = t.urlHash
       WHERE t.crawlId = ${targetId} AND NOT (t.statusCode <=> b.statusCode)`,
    prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM Page t
       JOIN Page b ON b.crawlId = ${baseId} AND b.urlHash = t.urlHash
       WHERE t.crawlId = ${targetId} AND t.indexabilityReason <> b.indexabilityReason`,
  ]);

  // ---- Issues por código
  const [baseIssues, targetIssues] = await Promise.all([
    prisma.issue.groupBy({
      by: ['code', 'severity', 'title'],
      where: { crawlId: baseId },
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ['code', 'severity', 'title'],
      where: { crawlId: targetId },
      _count: { _all: true },
    }),
  ]);

  const issueMap = new Map<
    string,
    { code: string; title: string; severity: string; before: number; after: number }
  >();

  for (const row of baseIssues) {
    issueMap.set(row.code, {
      code: row.code,
      title: row.title,
      severity: row.severity,
      before: row._count._all,
      after: 0,
    });
  }
  for (const row of targetIssues) {
    const existing = issueMap.get(row.code);
    if (existing) existing.after = row._count._all;
    else
      issueMap.set(row.code, {
        code: row.code,
        title: row.title,
        severity: row.severity,
        before: 0,
        after: row._count._all,
      });
  }

  const issueDeltas = [...issueMap.values()]
    .map((row) => ({ ...row, delta: row.after - row.before }))
    .filter((row) => row.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const metrics: MetricDelta[] = [
    metric('URLs rastreadas', base.crawledUrls, target.crawledUrls, true),
    metric(
      'Indexables',
      baseStats?.totals.indexable ?? 0,
      targetStats?.totals.indexable ?? 0,
      true,
    ),
    metric(
      'Errores 4xx/5xx',
      baseStats?.totals.errors ?? 0,
      targetStats?.totals.errors ?? 0,
      false,
    ),
    metric(
      'Redirecciones',
      baseStats?.totals.redirects ?? 0,
      targetStats?.totals.redirects ?? 0,
      false,
    ),
    metric(
      'Enlaces internos',
      baseStats?.totals.internalLinks ?? 0,
      targetStats?.totals.internalLinks ?? 0,
      true,
    ),
    metric(
      'Profundidad media',
      baseStats?.totals.averageDepth ?? 0,
      targetStats?.totals.averageDepth ?? 0,
      false,
    ),
    metric('SEO Health', baseStats?.seoHealth ?? 0, targetStats?.seoHealth ?? 0, true),
    metric(
      'GEO Readiness',
      baseStats?.geo.score ?? 0,
      targetStats?.geo.score ?? 0,
      true,
    ),
    metric(
      'Issues totales',
      baseIssues.reduce((sum, r) => sum + r._count._all, 0),
      targetIssues.reduce((sum, r) => sum + r._count._all, 0),
      false,
    ),
  ];

  return {
    base: {
      id: base.id,
      startUrl: base.startUrl,
      completedAt: base.completedAt?.toISOString() ?? null,
      pages: base.crawledUrls,
    },
    target: {
      id: target.id,
      startUrl: target.startUrl,
      completedAt: target.completedAt?.toISOString() ?? null,
      pages: target.crawledUrls,
    },
    metrics,
    addedUrls: added.map((r) => ({
      url: r.url,
      pageId: r.id.toString(),
      before: null,
      after: r.status,
    })),
    removedUrls: removed.map((r) => ({
      url: r.url,
      pageId: null,
      before: r.status,
      after: null,
    })),
    statusChanges: statusChanges.map((r) => ({
      url: r.url,
      pageId: r.id.toString(),
      before: r.before,
      after: r.after,
    })),
    indexabilityChanges: indexabilityChanges.map((r) => ({
      url: r.url,
      pageId: r.id.toString(),
      before: null,
      after: null,
      detail: `${r.beforeReason} → ${r.afterReason}`,
    })),
    issueDeltas,
    counts: {
      added: Number(addedCount[0]?.c ?? 0),
      removed: Number(removedCount[0]?.c ?? 0),
      statusChanged: Number(statusCount[0]?.c ?? 0),
      indexabilityChanged: Number(indexCount[0]?.c ?? 0),
    },
  };
}
