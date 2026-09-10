import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export type GraphFilters = {
  limit?: number;
  status?: string; // '2xx' | '3xx' | '4xx' | '5xx' | 'error'
  indexable?: boolean;
  maxDepth?: number;
  minDepth?: number;
  directory?: string;
  minInlinks?: number;
  maxInlinks?: number;
  issueCode?: string;
  search?: string;
};

export type GraphNode = {
  id: string;
  url: string;
  path: string;
  title: string | null;
  depth: number;
  pagerank: number;
  status: number | null;
  indexable: boolean;
  inlinks: number;
  outlinks: number;
  directory: string;
  issues: number;
};

export type GraphEdge = { source: string; target: string; anchor: string | null };

export type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  totalNodes: number;
};

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * Construye el grafo del sitio aplicando filtros server-side.
 * Nunca devuelve más de `limit` nodos (sección 57 del plan).
 */
export async function buildGraph(
  crawlId: string,
  filters: GraphFilters = {},
): Promise<GraphPayload> {
  const limit = Math.min(Math.max(filters.limit ?? 2000, 10), 20_000);

  const where: Prisma.PageWhereInput = { crawlId };

  if (filters.status) {
    const ranges: Record<string, Prisma.PageWhereInput> = {
      '2xx': { statusCode: { gte: 200, lt: 300 } },
      '3xx': { statusCode: { gte: 300, lt: 400 } },
      '4xx': { statusCode: { gte: 400, lt: 500 } },
      '5xx': { statusCode: { gte: 500 } },
      error: { statusCode: null },
    };
    Object.assign(where, ranges[filters.status] ?? {});
  }

  if (filters.indexable !== undefined) where.indexable = filters.indexable;
  if (filters.directory) where.directory = filters.directory;
  if (filters.search) where.normalizedUrl = { contains: filters.search };

  if (filters.minDepth !== undefined || filters.maxDepth !== undefined) {
    where.depth = {
      ...(filters.minDepth !== undefined ? { gte: filters.minDepth } : {}),
      ...(filters.maxDepth !== undefined ? { lte: filters.maxDepth } : {}),
    };
  }

  if (filters.minInlinks !== undefined || filters.maxInlinks !== undefined) {
    where.internalInlinks = {
      ...(filters.minInlinks !== undefined ? { gte: filters.minInlinks } : {}),
      ...(filters.maxInlinks !== undefined ? { lte: filters.maxInlinks } : {}),
    };
  }

  if (filters.issueCode) {
    const pages = await prisma.issue.findMany({
      where: { crawlId, code: filters.issueCode, pageId: { not: null } },
      select: { pageId: true },
      distinct: ['pageId'],
      take: limit,
    });
    where.id = { in: pages.map((p) => p.pageId!) };
  }

  const totalNodes = await prisma.page.count({ where });

  const pages = await prisma.page.findMany({
    where,
    orderBy: [{ internalPageRank: 'desc' }, { internalInlinks: 'desc' }],
    take: limit,
    select: {
      id: true,
      normalizedUrl: true,
      title: true,
      depth: true,
      internalPageRank: true,
      statusCode: true,
      indexable: true,
      internalInlinks: true,
      internalOutlinks: true,
      directory: true,
    },
  });

  if (pages.length === 0) {
    return { nodes: [], edges: [], truncated: false, totalNodes };
  }

  const ids = pages.map((p) => p.id);
  const idSet = new Set(ids.map((id) => id.toString()));

  const issueCounts = await prisma.issue.groupBy({
    by: ['pageId'],
    where: { crawlId, pageId: { in: ids } },
    _count: { _all: true },
  });
  const issuesByPage = new Map(
    issueCounts.map((r) => [r.pageId!.toString(), r._count._all]),
  );

  const nodes: GraphNode[] = pages.map((p) => ({
    id: p.id.toString(),
    url: p.normalizedUrl,
    path: pathOf(p.normalizedUrl),
    title: p.title,
    depth: p.depth,
    pagerank: p.internalPageRank ?? 0,
    status: p.statusCode,
    indexable: p.indexable,
    inlinks: p.internalInlinks,
    outlinks: p.internalOutlinks,
    directory: p.directory ?? '/',
    issues: issuesByPage.get(p.id.toString()) ?? 0,
  }));

  const links = await prisma.link.findMany({
    where: {
      crawlId,
      linkType: 'INTERNAL',
      sourcePageId: { in: ids },
      targetPageId: { in: ids },
    },
    select: { sourcePageId: true, targetPageId: true, anchorText: true },
    take: limit * 12,
  });

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const link of links) {
    const source = link.sourcePageId.toString();
    const target = link.targetPageId!.toString();
    if (source === target) continue;
    if (!idSet.has(source) || !idSet.has(target)) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source, target, anchor: link.anchorText });
  }

  return {
    nodes,
    edges,
    truncated: totalNodes > pages.length,
    totalNodes,
  };
}
