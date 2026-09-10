import { Prisma } from '@prisma/client';
import { prisma, retryOnConflict } from '../../lib/prisma';
import { pageRules } from '../seo/rules';
import type { PageContext, SeoIssue } from '../seo/rules/types';
import { pagerank } from '../graph/pagerank';
import { computeGraphMetrics } from '../graph/metrics';
import { computeGeoReadiness, type PageGeoSignals } from '../geo/signals';
import {
  detectNearDuplicates,
  validateHreflangSets,
  validateStructuredData,
} from './validators';

export type CrawlStats = {
  totals: {
    pages: number;
    indexable: number;
    nonIndexable: number;
    errors: number;
    redirects: number;
    internalLinks: number;
    externalLinks: number;
    averageDepth: number;
    averageResponseTime: number;
    averageWordCount: number;
  };
  statusDistribution: Record<string, number>;
  depthDistribution: Record<string, number>;
  indexabilityDistribution: Record<string, number>;
  issueSeverity: Record<string, number>;
  topIssues: { code: string; title: string; severity: string; count: number }[];
  directories: { directory: string; pages: number; indexable: number }[];
  geo: ReturnType<typeof computeGeoReadiness>;
  seoHealth: number;
  architecture: {
    communities: number;
    modularity: number | null;
    clusters: {
      clusterId: number;
      pages: number;
      topUrl: string;
      avgDepth: number;
      inboundFromOtherClusters: number;
    }[];
    topBottlenecks: { url: string; betweenness: number }[];
    topHubs: { url: string; hubScore: number }[];
    topAuthorities: { url: string; authorityScore: number }[];
  };
  computedAt: string;
};

const BATCH = 500;

/**
 * Pipeline post-crawl: métricas de enlazado → PageRank → reglas SEO →
 * agregados y score. Todo determinístico; la IA sólo lee el resultado.
 */
export async function analyzeCrawl(crawlId: string): Promise<CrawlStats> {
  await computeLinkMetrics(crawlId);
  await computePageRank(crawlId);
  const modularity = await computeAdvancedMetrics(crawlId);
  await runSeoRules(crawlId);
  const stats = await computeStats(crawlId, modularity);

  // El latido del worker sigue escribiendo en esta fila mientras se analiza.
  await retryOnConflict(() =>
    prisma.crawl.update({
      where: { id: crawlId },
      data: { stats: stats as unknown as Prisma.InputJsonValue },
    }),
  );

  return stats;
}

// --------------------------------------------------------------- Enlaces

async function computeLinkMetrics(crawlId: string) {
  // Resolvemos los targets que quedaron sin pageId (por orden de rastreo).
  await prisma.$executeRaw`
    UPDATE Link l
    JOIN Page p ON p.crawlId = l.crawlId AND p.urlHash = l.targetHash
    SET l.targetPageId = p.id
    WHERE l.crawlId = ${crawlId} AND l.targetPageId IS NULL
  `;

  // Inlinks totales y únicos por página destino.
  await prisma.$executeRaw`
    UPDATE Page p
    LEFT JOIN (
      SELECT targetPageId,
             COUNT(*) AS total,
             COUNT(DISTINCT sourcePageId) AS uniq
      FROM Link
      WHERE crawlId = ${crawlId}
        AND linkType = 'INTERNAL'
        AND targetPageId IS NOT NULL
      GROUP BY targetPageId
    ) agg ON agg.targetPageId = p.id
    SET p.internalInlinks = COALESCE(agg.total, 0),
        p.uniqueInlinks = COALESCE(agg.uniq, 0)
    WHERE p.crawlId = ${crawlId}
  `;

  // Outlinks internos/externos por página origen.
  await prisma.$executeRaw`
    UPDATE Page p
    LEFT JOIN (
      SELECT sourcePageId,
             SUM(linkType = 'INTERNAL') AS internal,
             COUNT(DISTINCT CASE WHEN linkType = 'INTERNAL' THEN targetHash END) AS uniqInternal,
             SUM(linkType = 'EXTERNAL') AS external
      FROM Link
      WHERE crawlId = ${crawlId}
      GROUP BY sourcePageId
    ) agg ON agg.sourcePageId = p.id
    SET p.internalOutlinks = COALESCE(agg.internal, 0),
        p.uniqueOutlinks = COALESCE(agg.uniqInternal, 0),
        p.externalOutlinks = COALESCE(agg.external, 0)
    WHERE p.crawlId = ${crawlId}
  `;

  // Huérfanas potenciales: en sitemap, sin inlinks y no es la home.
  await prisma.$executeRaw`
    UPDATE Page
    SET potentialOrphan =
      (inSitemap = 1 AND internalInlinks = 0 AND discoveryType <> 'START')
    WHERE crawlId = ${crawlId}
  `;
}

// -------------------------------------------------------------- PageRank

async function computePageRank(crawlId: string) {
  const pages = await prisma.page.findMany({
    where: { crawlId, indexable: true },
    select: { id: true },
  });

  if (pages.length === 0) return;

  const allowed = new Set(pages.map((p) => p.id.toString()));
  const nodes = [...allowed];

  const edges: { source: string; target: string }[] = [];
  let cursor: bigint | null = null;

  for (;;) {
    const chunk: { id: bigint; sourcePageId: bigint; targetPageId: bigint | null }[] =
      await prisma.link.findMany({
        where: {
          crawlId,
          linkType: 'INTERNAL',
          follow: true,
          targetPageId: { not: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, sourcePageId: true, targetPageId: true },
        orderBy: { id: 'asc' },
        take: 5000,
      });

    if (chunk.length === 0) break;
    cursor = chunk[chunk.length - 1].id;

    for (const link of chunk) {
      const s = link.sourcePageId.toString();
      const t = link.targetPageId!.toString();
      if (allowed.has(s) && allowed.has(t)) edges.push({ source: s, target: t });
    }
  }

  const ranks = pagerank(nodes, edges, { damping: 0.85, iterations: 40 });

  // Escribimos en lotes con CASE para no hacer N updates.
  const entries = [...ranks.entries()];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const cases = batch
      .map(([id, rank]) => `WHEN ${id} THEN ${rank.toExponential(10)}`)
      .join(' ');
    const ids = batch.map(([id]) => id).join(',');
    await prisma.$executeRawUnsafe(
      `UPDATE Page SET internalPageRank = CASE id ${cases} END WHERE id IN (${ids})`,
    );
  }

  await prisma.page.updateMany({
    where: { crawlId, indexable: false },
    data: { internalPageRank: 0 },
  });
}

// ------------------------------------- Betweenness, HITS y comunidades

/**
 * Métricas de arquitectura que van más allá del PageRank: cuellos de
 * botella, hubs/authorities y clusters reales de enlazado (Louvain).
 */
async function computeAdvancedMetrics(crawlId: string): Promise<number | null> {
  const pages = await prisma.page.findMany({
    where: { crawlId, indexable: true },
    select: { id: true },
  });
  if (pages.length === 0) return null;

  const allowed = new Set(pages.map((p) => p.id.toString()));
  const nodes = [...allowed];

  const edges: { source: string; target: string }[] = [];
  let cursor: bigint | null = null;

  for (;;) {
    const chunk: { id: bigint; sourcePageId: bigint; targetPageId: bigint | null }[] =
      await prisma.link.findMany({
        where: {
          crawlId,
          linkType: 'INTERNAL',
          follow: true,
          targetPageId: { not: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, sourcePageId: true, targetPageId: true },
        orderBy: { id: 'asc' },
        take: 5000,
      });

    if (chunk.length === 0) break;
    cursor = chunk[chunk.length - 1].id;

    for (const link of chunk) {
      const s = link.sourcePageId.toString();
      const t = link.targetPageId!.toString();
      if (allowed.has(s) && allowed.has(t)) edges.push({ source: s, target: t });
    }
  }

  const metrics = computeGraphMetrics(nodes, edges);

  // Un UPDATE por lote con CASE, igual que en PageRank.
  for (let i = 0; i < nodes.length; i += BATCH) {
    const batch = nodes.slice(i, i + BATCH);
    const ids = batch.join(',');

    const caseFor = (map: Map<string, number>, fallback: string) =>
      batch
        .map((id) => {
          const value = map.get(id);
          return `WHEN ${id} THEN ${value == null ? fallback : value}`;
        })
        .join(' ');

    await prisma.$executeRawUnsafe(
      `UPDATE Page SET
         betweenness = CASE id ${caseFor(metrics.betweenness, 'NULL')} END,
         hubScore = CASE id ${caseFor(metrics.hubs, 'NULL')} END,
         authorityScore = CASE id ${caseFor(metrics.authorities, 'NULL')} END,
         clusterId = CASE id ${caseFor(metrics.communities, 'NULL')} END
       WHERE id IN (${ids})`,
    );
  }

  return metrics.modularity;
}

// ------------------------------------------------------------ Reglas SEO

async function runSeoRules(crawlId: string) {
  await prisma.issue.deleteMany({ where: { crawlId } });

  let cursor: bigint | null = null;
  const buffer: SeoIssue[] = [];

  const flush = async (force = false) => {
    if (buffer.length === 0) return;
    if (!force && buffer.length < 1000) return;
    const rows = buffer.splice(0, buffer.length).map((i) => ({
      crawlId,
      pageId: i.pageId,
      url: i.url?.slice(0, 2000) ?? null,
      code: i.code,
      severity: i.severity,
      title: i.title.slice(0, 190),
      details: i.details ?? null,
    }));
    await prisma.issue.createMany({ data: rows });
  };

  for (;;) {
    const pages: PageContext[] = await prisma.page.findMany({
      where: { crawlId, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: {
        id: true,
        url: true,
        normalizedUrl: true,
        statusCode: true,
        errorType: true,
        contentType: true,
        title: true,
        titleLength: true,
        metaDescription: true,
        metaDescriptionLength: true,
        h1: true,
        h1Count: true,
        canonical: true,
        metaRobots: true,
        wordCount: true,
        depth: true,
        indexable: true,
        indexabilityReason: true,
        internalInlinks: true,
        imagesCount: true,
        imagesMissingAlt: true,
        inSitemap: true,
        potentialOrphan: true,
        redirectUrl: true,
      },
    });

    if (pages.length === 0) break;
    cursor = pages[pages.length - 1].id;

    for (const page of pages) {
      for (const rule of pageRules) {
        buffer.push(...rule.run(page));
      }
    }
    await flush();
  }

  await flush(true);

  await detectDuplicates(crawlId, 'title', 'DUPLICATE_TITLE', 'Title duplicado');
  await detectDuplicates(
    crawlId,
    'metaDescription',
    'DUPLICATE_DESCRIPTION',
    'Meta description duplicada',
  );
  await detectDuplicates(
    crawlId,
    'contentHash',
    'DUPLICATE_CONTENT',
    'Contenido duplicado',
  );
  await detectBrokenInternalLinks(crawlId);
  await detectNearDuplicates(crawlId);
  await validateStructuredData(crawlId);
  await validateHreflangSets(crawlId);
}

/** Marca como duplicado cualquier valor repetido en páginas indexables. */
async function detectDuplicates(
  crawlId: string,
  column: 'title' | 'metaDescription' | 'contentHash',
  code: string,
  title: string,
) {
  const rows = await prisma.$queryRawUnsafe<
    { id: bigint; normalizedUrl: string; value: string; cnt: bigint }[]
  >(
    `SELECT p.id, p.normalizedUrl, LEFT(p.${column}, 190) AS value, d.cnt
       FROM Page p
       JOIN (
         SELECT LEFT(${column}, 190) AS v, COUNT(*) AS cnt
           FROM Page
          WHERE crawlId = ? AND indexable = 1 AND ${column} IS NOT NULL AND ${column} <> ''
          GROUP BY v
         HAVING COUNT(*) > 1
       ) d ON d.v = LEFT(p.${column}, 190)
      WHERE p.crawlId = ? AND p.indexable = 1
      LIMIT 20000`,
    crawlId,
    crawlId,
  );

  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.issue.createMany({
      data: rows.slice(i, i + 1000).map((r) => ({
        crawlId,
        pageId: r.id,
        url: r.normalizedUrl.slice(0, 2000),
        code,
        severity: 'MEDIUM' as const,
        title,
        details: `Compartido por ${Number(r.cnt)} páginas: "${r.value ?? ''}"`,
      })),
    });
  }
}

/** Enlaces internos cuyo destino responde 4xx/5xx. */
async function detectBrokenInternalLinks(crawlId: string) {
  const rows = await prisma.$queryRaw<
    { sourceUrl: string; sourceId: bigint; targetUrl: string; status: number; anchor: string | null }[]
  >`
    SELECT sp.normalizedUrl AS sourceUrl,
           sp.id            AS sourceId,
           tp.normalizedUrl AS targetUrl,
           tp.statusCode    AS status,
           LEFT(l.anchorText, 120) AS anchor
      FROM Link l
      JOIN Page sp ON sp.id = l.sourcePageId
      JOIN Page tp ON tp.id = l.targetPageId
     WHERE l.crawlId = ${crawlId}
       AND l.linkType = 'INTERNAL'
       AND tp.statusCode >= 400
     LIMIT 20000
  `;

  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.issue.createMany({
      data: rows.slice(i, i + 1000).map((r) => ({
        crawlId,
        pageId: r.sourceId,
        url: r.sourceUrl.slice(0, 2000),
        code: 'BROKEN_INTERNAL_LINK',
        severity: 'HIGH' as const,
        title: 'Enlace interno roto',
        details: `→ ${r.targetUrl} (${r.status})${r.anchor ? ` · anchor: "${r.anchor}"` : ''}`,
      })),
    });
  }
}

// -------------------------------------------------------------- Métricas

async function computeStats(
  crawlId: string,
  modularity: number | null,
): Promise<CrawlStats> {
  const [
    total,
    indexable,
    errors,
    redirects,
    aggregates,
    statusRows,
    depthRows,
    reasonRows,
    severityRows,
    issueRows,
    directoryRows,
    linkTotals,
  ] = await Promise.all([
    prisma.page.count({ where: { crawlId } }),
    prisma.page.count({ where: { crawlId, indexable: true } }),
    prisma.page.count({ where: { crawlId, statusCode: { gte: 400 } } }),
    prisma.page.count({
      where: { crawlId, statusCode: { gte: 300, lt: 400 } },
    }),
    prisma.page.aggregate({
      where: { crawlId },
      _avg: { depth: true, responseTime: true, wordCount: true },
    }),
    prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
      SELECT CASE
               WHEN statusCode IS NULL THEN 'error'
               WHEN statusCode < 200 THEN '1xx'
               WHEN statusCode < 300 THEN '2xx'
               WHEN statusCode < 400 THEN '3xx'
               WHEN statusCode < 500 THEN '4xx'
               ELSE '5xx' END AS bucket,
             COUNT(*) AS count
        FROM Page WHERE crawlId = ${crawlId} GROUP BY bucket`,
    prisma.$queryRaw<{ depth: number; count: bigint }[]>`
      SELECT depth, COUNT(*) AS count FROM Page
       WHERE crawlId = ${crawlId} GROUP BY depth ORDER BY depth`,
    prisma.$queryRaw<{ indexabilityReason: string; count: bigint }[]>`
      SELECT indexabilityReason, COUNT(*) AS count FROM Page
       WHERE crawlId = ${crawlId} GROUP BY indexabilityReason`,
    prisma.$queryRaw<{ severity: string; count: bigint }[]>`
      SELECT severity, COUNT(*) AS count FROM Issue
       WHERE crawlId = ${crawlId} GROUP BY severity`,
    prisma.$queryRaw<{ code: string; title: string; severity: string; count: bigint }[]>`
      SELECT code, MIN(title) AS title, MIN(severity) AS severity, COUNT(*) AS count
        FROM Issue WHERE crawlId = ${crawlId}
       GROUP BY code ORDER BY count DESC LIMIT 25`,
    prisma.$queryRaw<{ directory: string; pages: bigint; indexable: bigint }[]>`
      SELECT COALESCE(directory, '/') AS directory,
             COUNT(*) AS pages,
             SUM(indexable = 1) AS indexable
        FROM Page WHERE crawlId = ${crawlId}
       GROUP BY directory ORDER BY pages DESC LIMIT 30`,
    prisma.$queryRaw<{ internal: bigint; external: bigint }[]>`
      SELECT SUM(linkType = 'INTERNAL') AS internal,
             SUM(linkType = 'EXTERNAL') AS external
        FROM Link WHERE crawlId = ${crawlId}`,
  ]);

  const toRecord = <T extends Record<string, unknown>>(
    rows: T[],
    key: keyof T,
  ): Record<string, number> =>
    Object.fromEntries(rows.map((r) => [String(r[key]), Number(r.count)]));

  const geo = await computeGeoStats(crawlId, indexable);
  const architecture = await computeArchitectureStats(crawlId, modularity);

  const severity = toRecord(severityRows, 'severity');
  const weight = { CRITICAL: 12, HIGH: 6, MEDIUM: 2.5, LOW: 0.8, INFO: 0 };
  const penalty =
    total > 0
      ? Object.entries(severity).reduce(
          (sum, [k, v]) => sum + (weight[k as keyof typeof weight] ?? 0) * v,
          0,
        ) / total
      : 0;
  const seoHealth = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    totals: {
      pages: total,
      indexable,
      nonIndexable: total - indexable,
      errors,
      redirects,
      internalLinks: Number(linkTotals[0]?.internal ?? 0),
      externalLinks: Number(linkTotals[0]?.external ?? 0),
      averageDepth: Number((aggregates._avg.depth ?? 0).toFixed(2)),
      averageResponseTime: Math.round(aggregates._avg.responseTime ?? 0),
      averageWordCount: Math.round(aggregates._avg.wordCount ?? 0),
    },
    statusDistribution: toRecord(statusRows, 'bucket'),
    depthDistribution: toRecord(depthRows, 'depth'),
    indexabilityDistribution: toRecord(reasonRows, 'indexabilityReason'),
    issueSeverity: severity,
    topIssues: issueRows.map((r) => ({
      code: r.code,
      title: r.title,
      severity: r.severity,
      count: Number(r.count),
    })),
    directories: directoryRows.map((r) => ({
      directory: r.directory,
      pages: Number(r.pages),
      indexable: Number(r.indexable),
    })),
    geo,
    seoHealth,
    architecture,
    computedAt: new Date().toISOString(),
  };
}

/** Resumen legible de comunidades, cuellos de botella y hubs/authorities. */
async function computeArchitectureStats(
  crawlId: string,
  modularity: number | null,
): Promise<CrawlStats['architecture']> {
  const [clusterRows, bottlenecks, hubs, authorities] = await Promise.all([
    prisma.$queryRaw<
      { clusterId: number; pages: bigint; avgDepth: number; topUrl: string }[]
    >`
      SELECT p.clusterId,
             COUNT(*)   AS pages,
             AVG(p.depth) AS avgDepth,
             SUBSTRING_INDEX(
               GROUP_CONCAT(p.normalizedUrl ORDER BY p.internalPageRank DESC SEPARATOR '|~|'),
               '|~|', 1
             ) AS topUrl
        FROM Page p
       WHERE p.crawlId = ${crawlId} AND p.clusterId IS NOT NULL
       GROUP BY p.clusterId
       ORDER BY pages DESC
       LIMIT 25`,
    prisma.page.findMany({
      where: { crawlId, betweenness: { not: null } },
      orderBy: { betweenness: 'desc' },
      take: 10,
      select: { normalizedUrl: true, betweenness: true },
    }),
    prisma.page.findMany({
      where: { crawlId, hubScore: { not: null } },
      orderBy: { hubScore: 'desc' },
      take: 10,
      select: { normalizedUrl: true, hubScore: true },
    }),
    prisma.page.findMany({
      where: { crawlId, authorityScore: { not: null } },
      orderBy: { authorityScore: 'desc' },
      take: 10,
      select: { normalizedUrl: true, authorityScore: true },
    }),
  ]);

  // Enlaces que entran a cada cluster desde fuera: mide su aislamiento.
  const inbound = await prisma.$queryRaw<
    { clusterId: number; inbound: bigint }[]
  >`
    SELECT tp.clusterId, COUNT(*) AS inbound
      FROM Link l
      JOIN Page sp ON sp.id = l.sourcePageId
      JOIN Page tp ON tp.id = l.targetPageId
     WHERE l.crawlId = ${crawlId}
       AND l.linkType = 'INTERNAL'
       AND tp.clusterId IS NOT NULL
       AND sp.clusterId IS NOT NULL
       AND sp.clusterId <> tp.clusterId
     GROUP BY tp.clusterId`;

  const inboundByCluster = new Map(
    inbound.map((r) => [r.clusterId, Number(r.inbound)]),
  );

  return {
    communities: clusterRows.length,
    modularity: modularity == null ? null : Number(modularity.toFixed(4)),
    clusters: clusterRows.map((r) => ({
      clusterId: r.clusterId,
      pages: Number(r.pages),
      topUrl: r.topUrl,
      avgDepth: Number(Number(r.avgDepth).toFixed(2)),
      inboundFromOtherClusters: inboundByCluster.get(r.clusterId) ?? 0,
    })),
    topBottlenecks: bottlenecks.map((p) => ({
      url: p.normalizedUrl,
      betweenness: Number((p.betweenness ?? 0).toFixed(6)),
    })),
    topHubs: hubs.map((p) => ({
      url: p.normalizedUrl,
      hubScore: Number((p.hubScore ?? 0).toFixed(6)),
    })),
    topAuthorities: authorities.map((p) => ({
      url: p.normalizedUrl,
      authorityScore: Number((p.authorityScore ?? 0).toFixed(6)),
    })),
  };
}

async function computeGeoStats(crawlId: string, totalIndexable: number) {
  const pages = await prisma.page.findMany({
    where: { crawlId, indexable: true },
    select: { normalizedUrl: true, geoSignals: true },
  });

  let withStructuredData = 0;
  let withOrganization = 0;
  let withBreadcrumbs = 0;
  let withAuthor = 0;
  let withDates = 0;
  let withGoodHeadings = 0;
  let withServerContent = 0;
  let withFaq = 0;
  let withCitations = 0;

  for (const page of pages) {
    const s = page.geoSignals as unknown as PageGeoSignals | null;
    if (!s) continue;
    if (s.hasStructuredData) withStructuredData++;
    if (s.schemaTypes?.some((t) => /organization|localbusiness/i.test(t)))
      withOrganization++;
    if (s.hasBreadcrumbs) withBreadcrumbs++;
    if (s.hasAuthor) withAuthor++;
    if (s.hasPublishedDate || s.hasModifiedDate) withDates++;
    if (s.headingStructureOk) withGoodHeadings++;
    if (s.hasServerRenderedContent) withServerContent++;
    if (s.hasFaq) withFaq++;
    if ((s.externalCitations ?? 0) > 0) withCitations++;
  }

  const urls = pages.map((p) => p.normalizedUrl.toLowerCase());
  const hasAboutPage = urls.some((u) => /\/(about|nosotros|quienes-somos|acerca)/.test(u));
  const hasContactPage = urls.some((u) => /\/(contact|contacto)/.test(u));

  return computeGeoReadiness({
    totalIndexable: totalIndexable || pages.length,
    withStructuredData,
    withOrganization,
    withBreadcrumbs,
    withAuthor,
    withDates,
    withGoodHeadings,
    withServerContent,
    withFaq,
    withCitations,
    hasAboutPage,
    hasContactPage,
  });
}
