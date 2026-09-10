import { assertCrawlWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { enqueueCrawl } from '@/src/queue/crawl-queue';

type Params = { params: Promise<{ crawlId: string }> };

/** Alias de `POST /api/crawls/:crawlId/control` con action=start. */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    const crawl = await assertCrawlWrite(crawlId, user.id);

    if (['RUNNING', 'QUEUED'].includes(crawl.status)) {
      return fail('El crawl ya está en ejecución', 409);
    }

    const updated = await enqueueCrawl(crawlId, { reset: true });
    return ok({ crawl: updated });
  });
}
