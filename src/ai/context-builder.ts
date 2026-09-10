import { prisma } from '../../lib/prisma';
import { analyzeCrawl, type CrawlStats } from '../analysis/analyze-crawl';

export type AuditContext = {
  project: { name: string; domain: string };
  crawl: {
    id: string;
    startUrl: string;
    status: string;
    maxUrls: number;
    maxDepth: number;
    crawledUrls: number;
    failedUrls: number;
    durationSeconds: number | null;
  };
  totals: CrawlStats['totals'];
  statusDistribution: Record<string, number>;
  depthDistribution: Record<string, number>;
  indexabilityDistribution: Record<string, number>;
  issueSeverity: Record<string, number>;
  topIssues: CrawlStats['topIssues'];
  directories: CrawlStats['directories'];
  seoHealth: number;
  geo: CrawlStats['geo'];
  topPagesByPageRank: {
    url: string;
    pagerank: number;
    inlinks: number;
    depth: number;
  }[];
  lowInlinkPages: { url: string; inlinks: number; pagerank: number; depth: number }[];
  deepPages: { url: string; depth: number; inlinks: number }[];
  brokenPages: { url: string; status: number | null; inlinks: number }[];
  redirects: { url: string; status: number | null; target: string | null }[];
  duplicateTitles: { value: string; count: number }[];
  duplicateDescriptions: { value: string; count: number }[];
  canonicalIssues: { url: string; canonical: string | null }[];
  orphanCandidates: string[];
  schemaCoverage: { schemaType: string; pages: number }[];
  sampleIssueUrls: Record<string, string[]>;
};

/**
 * Construye el resumen estructurado del crawl que se envía al LLM.
 *
 * Nunca se manda HTML ni el listado completo de URLs: sólo agregados y
 * muestras acotadas (secciones 38–39 del plan).
 */
export async function buildAuditContext(crawlId: string): Promise<AuditContext> {
  const crawl = await prisma.crawl.findUnique({
    where: { id: crawlId },
    include: { project: true },
  });
  if (!crawl) throw new Error('Crawl no encontrado');

  const stats =
    (crawl.stats as unknown as CrawlStats | null) ??
    (await analyzeCrawl(crawlId));

  const [
    topPagesByPageRank,
    lowInlinkPages,
    deepPages,
    brokenPages,
    redirects,
    duplicateTitles,
    duplicateDescriptions,
    canonicalIssues,
    orphanCandidates,
    schemaCoverage,
  ] = await Promise.all([
    prisma.page.findMany({
      where: { crawlId, indexable: true },
      orderBy: { internalPageRank: 'desc' },
      take: 20,
      select: {
        normalizedUrl: true,
        internalPageRank: true,
        internalInlinks: true,
        depth: true,
      },
    }),
    prisma.page.findMany({
      where: { crawlId, indexable: true, internalInlinks: { lte: 1 }, depth: { gt: 0 } },
      orderBy: { internalPageRank: 'desc' },
      take: 25,
      select: {
        normalizedUrl: true,
        internalInlinks: true,
        internalPageRank: true,
        depth: true,
      },
    }),
    prisma.page.findMany({
      where: { crawlId, indexable: true, depth: { gt: 4 } },
      orderBy: { depth: 'desc' },
      take: 25,
      select: { normalizedUrl: true, depth: true, internalInlinks: true },
    }),
    prisma.page.findMany({
      where: { crawlId, statusCode: { gte: 400 } },
      orderBy: { internalInlinks: 'desc' },
      take: 25,
      select: { normalizedUrl: true, statusCode: true, internalInlinks: true },
    }),
    prisma.page.findMany({
      where: { crawlId, statusCode: { gte: 300, lt: 400 } },
      orderBy: { internalInlinks: 'desc' },
      take: 20,
      select: { normalizedUrl: true, statusCode: true, redirectUrl: true },
    }),
    prisma.$queryRaw<{ value: string; count: bigint }[]>`
      SELECT LEFT(title, 150) AS value, COUNT(*) AS count
        FROM Page
       WHERE crawlId = ${crawlId} AND indexable = 1 AND title IS NOT NULL AND title <> ''
       GROUP BY value HAVING COUNT(*) > 1
       ORDER BY count DESC LIMIT 15`,
    prisma.$queryRaw<{ value: string; count: bigint }[]>`
      SELECT LEFT(metaDescription, 150) AS value, COUNT(*) AS count
        FROM Page
       WHERE crawlId = ${crawlId} AND indexable = 1 AND metaDescription IS NOT NULL AND metaDescription <> ''
       GROUP BY value HAVING COUNT(*) > 1
       ORDER BY count DESC LIMIT 15`,
    prisma.page.findMany({
      where: { crawlId, indexabilityReason: 'CANONICALIZED' },
      take: 20,
      select: { normalizedUrl: true, canonical: true },
    }),
    prisma.page.findMany({
      where: { crawlId, potentialOrphan: true },
      take: 25,
      select: { normalizedUrl: true },
    }),
    prisma.$queryRaw<{ schemaType: string; pages: bigint }[]>`
      SELECT s.schemaType, COUNT(DISTINCT s.pageId) AS pages
        FROM SchemaMarkup s
        JOIN Page p ON p.id = s.pageId
       WHERE p.crawlId = ${crawlId} AND s.schemaType IS NOT NULL
       GROUP BY s.schemaType ORDER BY pages DESC LIMIT 20`,
  ]);

  // Muestra de URLs por cada uno de los issues más frecuentes. Pocas y
  // cortas: la IA sólo necesita ejemplos, no el listado completo.
  const sampleIssueUrls: Record<string, string[]> = {};
  for (const issue of stats.topIssues.slice(0, 8)) {
    const rows = await prisma.issue.findMany({
      where: { crawlId, code: issue.code },
      take: 5,
      select: { url: true },
    });
    sampleIssueUrls[issue.code] = rows
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u));
  }

  const durationSeconds =
    crawl.startedAt && crawl.completedAt
      ? Math.round(
          (crawl.completedAt.getTime() - crawl.startedAt.getTime()) / 1000,
        )
      : null;

  return {
    project: { name: crawl.project.name, domain: crawl.project.domain },
    crawl: {
      id: crawl.id,
      startUrl: crawl.startUrl,
      status: crawl.status,
      maxUrls: crawl.maxUrls,
      maxDepth: crawl.maxDepth,
      crawledUrls: crawl.crawledUrls,
      failedUrls: crawl.failedUrls,
      durationSeconds,
    },
    totals: stats.totals,
    statusDistribution: stats.statusDistribution,
    depthDistribution: stats.depthDistribution,
    indexabilityDistribution: stats.indexabilityDistribution,
    issueSeverity: stats.issueSeverity,
    topIssues: stats.topIssues,
    directories: stats.directories,
    seoHealth: stats.seoHealth,
    geo: stats.geo,
    topPagesByPageRank: topPagesByPageRank.map((p) => ({
      url: p.normalizedUrl,
      pagerank: Number((p.internalPageRank ?? 0).toFixed(6)),
      inlinks: p.internalInlinks,
      depth: p.depth,
    })),
    lowInlinkPages: lowInlinkPages.map((p) => ({
      url: p.normalizedUrl,
      inlinks: p.internalInlinks,
      pagerank: Number((p.internalPageRank ?? 0).toFixed(6)),
      depth: p.depth,
    })),
    deepPages: deepPages.map((p) => ({
      url: p.normalizedUrl,
      depth: p.depth,
      inlinks: p.internalInlinks,
    })),
    brokenPages: brokenPages.map((p) => ({
      url: p.normalizedUrl,
      status: p.statusCode,
      inlinks: p.internalInlinks,
    })),
    redirects: redirects.map((p) => ({
      url: p.normalizedUrl,
      status: p.statusCode,
      target: p.redirectUrl,
    })),
    duplicateTitles: duplicateTitles.map((r) => ({
      value: r.value,
      count: Number(r.count),
    })),
    duplicateDescriptions: duplicateDescriptions.map((r) => ({
      value: r.value,
      count: Number(r.count),
    })),
    canonicalIssues: canonicalIssues.map((p) => ({
      url: p.normalizedUrl,
      canonical: p.canonical,
    })),
    orphanCandidates: orphanCandidates.map((p) => p.normalizedUrl),
    schemaCoverage: schemaCoverage.map((r) => ({
      schemaType: r.schemaType,
      pages: Number(r.pages),
    })),
    sampleIssueUrls,
  };
}
