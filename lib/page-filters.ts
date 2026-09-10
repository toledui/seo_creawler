import { Prisma } from '@prisma/client';

/**
 * Construye el `where` de Prisma para el inventario de URLs a partir de los
 * query params. Vive fuera del route handler porque Next.js no permite
 * exportar nada que no sea un método HTTP desde un `route.ts`.
 */
export function pageFiltersFrom(searchParams: URLSearchParams, crawlId: string) {
  const where: Prisma.PageWhereInput = { crawlId };

  const status = searchParams.get('status');
  if (status) {
    const ranges: Record<string, Prisma.PageWhereInput> = {
      '2xx': { statusCode: { gte: 200, lt: 300 } },
      '3xx': { statusCode: { gte: 300, lt: 400 } },
      '4xx': { statusCode: { gte: 400, lt: 500 } },
      '5xx': { statusCode: { gte: 500 } },
      error: { statusCode: null },
    };
    Object.assign(where, ranges[status] ?? {});
  }

  const indexable = searchParams.get('indexable');
  if (indexable === 'true') where.indexable = true;
  if (indexable === 'false') where.indexable = false;

  const reason = searchParams.get('reason');
  if (reason) where.indexabilityReason = reason;

  const directory = searchParams.get('directory');
  if (directory) where.directory = directory;

  const search = searchParams.get('search');
  if (search) {
    where.OR = [
      { normalizedUrl: { contains: search } },
      { title: { contains: search } },
    ];
  }

  const minDepth = searchParams.get('minDepth');
  const maxDepth = searchParams.get('maxDepth');
  if (minDepth || maxDepth) {
    where.depth = {
      ...(minDepth ? { gte: Number(minDepth) } : {}),
      ...(maxDepth ? { lte: Number(maxDepth) } : {}),
    };
  }

  const minInlinks = searchParams.get('minInlinks');
  const maxInlinks = searchParams.get('maxInlinks');
  if (minInlinks || maxInlinks) {
    where.internalInlinks = {
      ...(minInlinks ? { gte: Number(minInlinks) } : {}),
      ...(maxInlinks ? { lte: Number(maxInlinks) } : {}),
    };
  }

  if (searchParams.get('orphan') === 'true') where.potentialOrphan = true;

  return where;
}

