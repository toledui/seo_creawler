import { assertCrawlOwner, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { buildTree, type TreeFilters } from '@/src/graph/tree-builder';

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

    const modeParam = sp.get('mode');
    const modes = ['path', 'link', 'inlinks', 'cluster', 'silo'] as const;

    const filters: TreeFilters = {
      mode: modes.includes(modeParam as (typeof modes)[number])
        ? (modeParam as (typeof modes)[number])
        : 'path',
      focus: sp.get('focus') ?? undefined,
      limit: numeric('limit') ?? 1500,
      maxDepth: numeric('maxDepth'),
      status: sp.get('status') ?? undefined,
      indexable:
        indexableRaw === 'true' ? true : indexableRaw === 'false' ? false : undefined,
      directory: sp.get('directory') ?? undefined,
      search: sp.get('search') ?? undefined,
      grouping: sp.get('grouping') === 'slug' ? 'slug' : 'path',
    };

    const tree = await buildTree(crawlId, filters);
    return ok(tree);
  });
}
