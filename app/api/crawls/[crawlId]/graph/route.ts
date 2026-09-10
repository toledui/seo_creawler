import { assertCrawlOwner, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { buildGraph, type GraphFilters } from '@/src/graph/graph-builder';

type Params = { params: Promise<{ crawlId: string }> };

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { crawlId } = await params;
    await assertCrawlOwner(crawlId, user.id);

    const sp = new URL(request.url).searchParams;

    const numeric = (key: string) => {
      const raw = sp.get(key);
      if (raw == null || raw === '') return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };

    const indexableRaw = sp.get('indexable');

    const filters: GraphFilters = {
      limit: numeric('limit') ?? 2000,
      status: sp.get('status') ?? undefined,
      indexable:
        indexableRaw === 'true' ? true : indexableRaw === 'false' ? false : undefined,
      minDepth: numeric('minDepth'),
      maxDepth: numeric('maxDepth'),
      directory: sp.get('directory') ?? undefined,
      minInlinks: numeric('minInlinks'),
      maxInlinks: numeric('maxInlinks'),
      issueCode: sp.get('issue') ?? undefined,
      search: sp.get('search') ?? undefined,
    };

    const graph = await buildGraph(crawlId, filters);
    return ok(graph);
  });
}
