import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';

type Params = { params: Promise<{ pageId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { pageId } = await params;

    let id: bigint;
    try {
      id = BigInt(pageId);
    } catch {
      return fail('Identificador de página inválido', 400);
    }

    const page = await prisma.page.findFirst({
      where: { id, crawl: { project: { userId: user.id } } },
      include: {
        crawl: { include: { project: true } },
        headings: { orderBy: { order: 'asc' } },
        images: { take: 200 },
        schemas: true,
        hreflangs: true,
      },
    });

    if (!page) return fail('Página no encontrada', 404);

    const [issues, inlinks, outlinks] = await Promise.all([
      prisma.issue.findMany({ where: { pageId: id }, orderBy: { severity: 'asc' } }),
      prisma.link.findMany({
        where: { targetPageId: id },
        take: 200,
        include: { sourcePage: { select: { id: true, normalizedUrl: true } } },
      }),
      prisma.link.findMany({
        where: { sourcePageId: id },
        take: 500,
        include: { targetPage: { select: { id: true, statusCode: true } } },
      }),
    ]);

    return ok({ page, issues, inlinks, outlinks });
  });
}
