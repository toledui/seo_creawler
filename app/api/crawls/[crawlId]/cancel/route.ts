import { prisma } from '@/lib/prisma';
import { assertCrawlWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { signalCrawl } from '@/src/queue/crawl-queue';

type Params = { params: Promise<{ crawlId: string }> };

/** Alias de `POST /api/crawls/:crawlId/control` con action=cancel. */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    const crawl = await assertCrawlWrite(crawlId, user.id);

    if (!['RUNNING', 'QUEUED'].includes(crawl.status)) {
      return fail('El crawl no está activo', 409);
    }

    await signalCrawl(crawlId, 'CANCEL');

    if (crawl.status === 'QUEUED') {
      await prisma.crawl.update({
        where: { id: crawlId },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
    }

    const updated = await prisma.crawl.findUnique({ where: { id: crawlId } });
    return ok({ crawl: updated });
  });
}
