import { prisma } from '../../lib/prisma';
import { buildAuditContext } from './context-builder';
import type { ToolDefinition } from './deepseek-client';

/**
 * Herramientas controladas para el chat (sección 43 del plan).
 * La IA nunca ejecuta SQL libre: sólo puede llamar a estas funciones,
 * siempre acotadas al crawlId de la conversación.
 */

type ToolHandler = (
  crawlId: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const clampLimit = (value: unknown, fallback = 20) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 100) : fallback;
};

export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getCrawlSummary',
      description:
        'Resumen agregado del crawl: totales, distribución de status, profundidad, issues, score SEO y GEO.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPagesByIssue',
      description: 'URLs afectadas por un código de issue concreto.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Código, p.ej. MISSING_TITLE' },
          limit: { type: 'number' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTopPagesByPageRank',
      description: 'Páginas con mayor PageRank interno.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getLowInlinkPages',
      description: 'Páginas indexables con pocos enlaces internos entrantes.',
      parameters: {
        type: 'object',
        properties: {
          maxInlinks: { type: 'number' },
          limit: { type: 'number' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDeepPages',
      description: 'Páginas con profundidad de clic mayor a un umbral.',
      parameters: {
        type: 'object',
        properties: { minDepth: { type: 'number' }, limit: { type: 'number' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getBrokenLinks',
      description: 'Enlaces internos que apuntan a URLs con status 4xx o 5xx.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getRedirects',
      description: 'URLs internas que responden con 3xx y su destino.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPageDetails',
      description: 'Detalle SEO completo de una URL concreta del crawl.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getLinksToPage',
      description: 'Enlaces internos entrantes de una URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' }, limit: { type: 'number' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getLinksFromPage',
      description: 'Enlaces salientes de una URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' }, limit: { type: 'number' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDirectoryBreakdown',
      description: 'Métricas agregadas por directorio de primer nivel.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

async function findPage(crawlId: string, url: string) {
  return prisma.page.findFirst({
    where: {
      crawlId,
      OR: [{ normalizedUrl: url }, { normalizedUrl: { contains: url } }],
    },
  });
}

export const toolHandlers: Record<string, ToolHandler> = {
  async getCrawlSummary(crawlId) {
    const context = await buildAuditContext(crawlId);
    return {
      totals: context.totals,
      statusDistribution: context.statusDistribution,
      depthDistribution: context.depthDistribution,
      indexabilityDistribution: context.indexabilityDistribution,
      topIssues: context.topIssues,
      seoHealth: context.seoHealth,
      geo: context.geo,
    };
  },

  async getPagesByIssue(crawlId, args) {
    const rows = await prisma.issue.findMany({
      where: { crawlId, code: String(args.code) },
      take: clampLimit(args.limit),
      select: { url: true, details: true, severity: true },
    });
    return { code: args.code, count: rows.length, pages: rows };
  },

  async getTopPagesByPageRank(crawlId, args) {
    const rows = await prisma.page.findMany({
      where: { crawlId, indexable: true },
      orderBy: { internalPageRank: 'desc' },
      take: clampLimit(args.limit),
      select: {
        normalizedUrl: true,
        internalPageRank: true,
        internalInlinks: true,
        depth: true,
        title: true,
      },
    });
    return rows;
  },

  async getLowInlinkPages(crawlId, args) {
    const maxInlinks = Number(args.maxInlinks ?? 1);
    const rows = await prisma.page.findMany({
      where: {
        crawlId,
        indexable: true,
        depth: { gt: 0 },
        internalInlinks: { lte: Number.isFinite(maxInlinks) ? maxInlinks : 1 },
      },
      orderBy: { internalPageRank: 'desc' },
      take: clampLimit(args.limit, 25),
      select: {
        normalizedUrl: true,
        internalInlinks: true,
        depth: true,
        internalPageRank: true,
        title: true,
      },
    });
    return rows;
  },

  async getDeepPages(crawlId, args) {
    const minDepth = Number(args.minDepth ?? 4);
    const rows = await prisma.page.findMany({
      where: {
        crawlId,
        indexable: true,
        depth: { gt: Number.isFinite(minDepth) ? minDepth : 4 },
      },
      orderBy: { depth: 'desc' },
      take: clampLimit(args.limit, 25),
      select: { normalizedUrl: true, depth: true, internalInlinks: true },
    });
    return rows;
  },

  async getBrokenLinks(crawlId, args) {
    const limit = clampLimit(args.limit, 25);
    const rows = await prisma.$queryRaw<
      { source: string; target: string; status: number; anchor: string | null }[]
    >`
      SELECT sp.normalizedUrl AS source, tp.normalizedUrl AS target,
             tp.statusCode AS status, LEFT(l.anchorText, 100) AS anchor
        FROM Link l
        JOIN Page sp ON sp.id = l.sourcePageId
        JOIN Page tp ON tp.id = l.targetPageId
       WHERE l.crawlId = ${crawlId} AND l.linkType = 'INTERNAL' AND tp.statusCode >= 400
       LIMIT ${limit}`;
    return rows;
  },

  async getRedirects(crawlId, args) {
    const rows = await prisma.page.findMany({
      where: { crawlId, statusCode: { gte: 300, lt: 400 } },
      orderBy: { internalInlinks: 'desc' },
      take: clampLimit(args.limit, 25),
      select: {
        normalizedUrl: true,
        statusCode: true,
        redirectUrl: true,
        internalInlinks: true,
      },
    });
    return rows;
  },

  async getPageDetails(crawlId, args) {
    const page = await findPage(crawlId, String(args.url));
    if (!page) return { error: 'URL no encontrada en este crawl' };
    return {
      url: page.normalizedUrl,
      status: page.statusCode,
      title: page.title,
      titleLength: page.titleLength,
      metaDescription: page.metaDescription,
      h1: page.h1,
      h1Count: page.h1Count,
      canonical: page.canonical,
      metaRobots: page.metaRobots,
      indexable: page.indexable,
      indexabilityReason: page.indexabilityReason,
      wordCount: page.wordCount,
      depth: page.depth,
      inlinks: page.internalInlinks,
      outlinks: page.internalOutlinks,
      externalLinks: page.externalOutlinks,
      pagerank: page.internalPageRank,
      responseTime: page.responseTime,
      geoSignals: page.geoSignals,
    };
  },

  async getLinksToPage(crawlId, args) {
    const page = await findPage(crawlId, String(args.url));
    if (!page) return { error: 'URL no encontrada en este crawl' };
    const rows = await prisma.link.findMany({
      where: { crawlId, targetPageId: page.id },
      take: clampLimit(args.limit, 25),
      include: { sourcePage: { select: { normalizedUrl: true } } },
    });
    return rows.map((l) => ({
      from: l.sourcePage.normalizedUrl,
      anchor: l.anchorText,
      follow: l.follow,
    }));
  },

  async getLinksFromPage(crawlId, args) {
    const page = await findPage(crawlId, String(args.url));
    if (!page) return { error: 'URL no encontrada en este crawl' };
    const rows = await prisma.link.findMany({
      where: { crawlId, sourcePageId: page.id },
      take: clampLimit(args.limit, 25),
    });
    return rows.map((l) => ({
      to: l.targetUrl,
      anchor: l.anchorText,
      type: l.linkType,
      follow: l.follow,
    }));
  },

  async getDirectoryBreakdown(crawlId) {
    const rows = await prisma.$queryRaw<
      {
        directory: string;
        pages: bigint;
        indexable: bigint;
        avgDepth: number;
        avgInlinks: number;
      }[]
    >`
      SELECT COALESCE(directory, '/') AS directory,
             COUNT(*) AS pages,
             SUM(indexable = 1) AS indexable,
             AVG(depth) AS avgDepth,
             AVG(internalInlinks) AS avgInlinks
        FROM Page WHERE crawlId = ${crawlId}
       GROUP BY directory ORDER BY pages DESC LIMIT 40`;
    return rows.map((r) => ({
      directory: r.directory,
      pages: Number(r.pages),
      indexable: Number(r.indexable),
      avgDepth: Number(Number(r.avgDepth).toFixed(2)),
      avgInlinks: Number(Number(r.avgInlinks).toFixed(2)),
    }));
  },
};

export const CHAT_SYSTEM_PROMPT = `Eres un analista SEO que responde preguntas sobre un rastreo concreto de un sitio web.

Dispones de herramientas para consultar los datos reales del crawl. Úsalas siempre antes de responder: nunca inventes cifras ni URLs.

Pautas:
- Empieza normalmente por getCrawlSummary para tener contexto.
- Encadena las herramientas que necesites (máximo unas pocas por respuesta).
- Responde en español, de forma concreta y accionable, citando URLs y números reales.
- Si los datos no permiten responder, dilo claramente en lugar de especular.
- Formatea listas y tablas en Markdown cuando ayude a la lectura.`;
