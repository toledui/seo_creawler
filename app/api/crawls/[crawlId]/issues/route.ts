import { prisma } from '@/lib/prisma';
import { assertCrawlOwner, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { ruleByCode } from '@/src/seo/rules';

type Params = { params: Promise<{ crawlId: string }> };

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    await assertCrawlOwner(crawlId, user.id);

    const sp = new URL(request.url).searchParams;
    const code = sp.get('code');

    // Vista agrupada (dashboard de issues)
    if (!code) {
      const grouped = await prisma.issue.groupBy({
        by: ['code', 'severity', 'title'],
        where: { crawlId },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
      });

      return ok({
        issues: grouped.map((g) => ({
          code: g.code,
          severity: g.severity,
          title: g.title,
          count: g._count._all,
          description: ruleByCode.get(g.code)?.description ?? null,
        })),
      });
    }

    // Detalle: URLs afectadas por un código concreto
    const page = Math.max(1, Number(sp.get('page') ?? 1));
    const perPage = Math.min(200, Math.max(10, Number(sp.get('perPage') ?? 50)));

    const [total, rows] = await Promise.all([
      prisma.issue.count({ where: { crawlId, code } }),
      prisma.issue.findMany({
        where: { crawlId, code },
        orderBy: { id: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return ok({
      code,
      description: ruleByCode.get(code)?.description ?? null,
      items: rows,
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  });
}
