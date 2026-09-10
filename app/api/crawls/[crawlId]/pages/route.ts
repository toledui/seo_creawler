import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { pageFiltersFrom } from '@/lib/page-filters';
import { assertCrawlOwner, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';

type Params = { params: Promise<{ crawlId: string }> };

const SORTABLE = new Set([
  'url',
  'statusCode',
  'depth',
  'wordCount',
  'internalInlinks',
  'internalOutlinks',
  'externalOutlinks',
  'internalPageRank',
  'responseTime',
  'titleLength',
  'metaDescriptionLength',
]);

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    await assertCrawlOwner(crawlId, user.id);

    const url = new URL(request.url);
    const sp = url.searchParams;

    const page = Math.max(1, Number(sp.get('page') ?? 1));
    const perPage = Math.min(200, Math.max(10, Number(sp.get('perPage') ?? 50)));

    const sortRaw = sp.get('sort') ?? 'internalPageRank';
    const sort = SORTABLE.has(sortRaw) ? sortRaw : 'internalPageRank';
    const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc';

    const where = pageFiltersFrom(sp, crawlId);

    const issueCode = sp.get('issue');
    if (issueCode) {
      const rows = await prisma.issue.findMany({
        where: { crawlId, code: issueCode, pageId: { not: null } },
        select: { pageId: true },
        distinct: ['pageId'],
        take: 50_000,
      });
      where.id = { in: rows.map((r) => r.pageId!) };
    }

    const orderBy =
      sort === 'url'
        ? { normalizedUrl: dir as 'asc' | 'desc' }
        : ({ [sort]: dir } as Prisma.PageOrderByWithRelationInput);

    const [total, rows] = await Promise.all([
      prisma.page.count({ where }),
      prisma.page.findMany({
        where,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          normalizedUrl: true,
          statusCode: true,
          contentType: true,
          title: true,
          titleLength: true,
          metaDescription: true,
          metaDescriptionLength: true,
          h1: true,
          h1Count: true,
          canonical: true,
          metaRobots: true,
          indexable: true,
          indexabilityReason: true,
          wordCount: true,
          depth: true,
          internalInlinks: true,
          internalOutlinks: true,
          externalOutlinks: true,
          internalPageRank: true,
          responseTime: true,
          errorType: true,
          potentialOrphan: true,
        },
      }),
    ]);

    return ok({
      pages: rows,
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    });
  });
}
