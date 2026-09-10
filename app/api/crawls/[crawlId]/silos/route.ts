import { assertCrawlOwner, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import {
  analyzeSilos,
  type SiloDepth,
  type SiloGrouping,
} from '@/src/graph/silo-analyzer';

type Params = { params: Promise<{ crawlId: string }> };

export const maxDuration = 120;

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    await assertCrawlOwner(crawlId, user.id);

    const sp = new URL(request.url).searchParams;
    const depth: SiloDepth = sp.get('depth') === '2' ? 2 : 1;
    const grouping: SiloGrouping = sp.get('grouping') === 'slug' ? 'slug' : 'path';

    return ok(await analyzeSilos(crawlId, { depth, grouping }));
  });
}
