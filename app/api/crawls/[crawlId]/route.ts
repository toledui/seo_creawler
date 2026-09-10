import { prisma } from '@/lib/prisma';
import { assertCrawlOwner, assertCrawlWrite, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';

type Params = { params: Promise<{ crawlId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    const crawl = await assertCrawlOwner(crawlId, user.id);

    const events = await prisma.crawlEvent.findMany({
      where: { crawlId },
      orderBy: { id: 'desc' },
      take: 30,
    });

    const elapsed = crawl.startedAt
      ? ((crawl.completedAt ?? new Date()).getTime() - crawl.startedAt.getTime()) / 1000
      : 0;

    return ok({
      crawl,
      events,
      metrics: {
        elapsedSeconds: Math.round(elapsed),
        urlsPerMinute:
          elapsed > 0 ? Math.round((crawl.crawledUrls / elapsed) * 60) : 0,
        pending: Math.max(0, crawl.discoveredUrls - crawl.crawledUrls),
      },
    });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    await assertCrawlWrite(crawlId, user.id);

    await prisma.crawl.delete({ where: { id: crawlId } });
    return ok({ success: true });
  });
}
