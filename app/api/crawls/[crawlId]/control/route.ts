import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertCrawlWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { enqueueCrawl, signalCrawl } from '@/src/queue/crawl-queue';

type Params = { params: Promise<{ crawlId: string }> };

const schema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'cancel']),
});

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    const crawl = await assertCrawlWrite(crawlId, user.id);

    const { action } = schema.parse(await request.json());

    switch (action) {
      case 'resume': {
        if (['RUNNING', 'QUEUED'].includes(crawl.status)) {
          return fail('El crawl ya está en ejecución', 409);
        }
        // Sin reset: la frontera persistida continúa donde se quedó.
        await enqueueCrawl(crawlId, { reset: false });
        break;
      }
      case 'start': {
        if (['RUNNING', 'QUEUED'].includes(crawl.status)) {
          return fail('El crawl ya está en ejecución', 409);
        }
        // Re-rastreo limpio: el worker borra los datos anteriores.
        await enqueueCrawl(crawlId, { reset: true });
        break;
      }
      case 'pause': {
        if (crawl.status !== 'RUNNING') {
          return fail('Sólo se puede pausar un crawl en ejecución', 409);
        }
        await signalCrawl(crawlId, 'PAUSE');
        break;
      }
      case 'cancel': {
        if (['RUNNING', 'QUEUED'].includes(crawl.status)) {
          await signalCrawl(crawlId, 'CANCEL');
          if (crawl.status === 'QUEUED') {
            await prisma.crawl.update({
              where: { id: crawlId },
              data: { status: 'CANCELLED', completedAt: new Date() },
            });
          }
        } else {
          return fail('El crawl no está activo', 409);
        }
        break;
      }
    }

    const updated = await prisma.crawl.findUnique({ where: { id: crawlId } });
    return ok({ crawl: updated });
  });
}
