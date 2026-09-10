import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { keywordSummary } from '@/lib/keyword-summary';
import {
  isValidKeyword,
  normalizeCountry,
  normalizeDevice,
  normalizeKeyword,
} from '@/src/keywords/normalize';

type Params = { params: Promise<{ projectId: string }> };

const SORTABLE = new Set([
  'keyword',
  'lastPosition',
  'bestPosition',
  'lastClicks',
  'lastImpressions',
  'lastCtr',
  'lastCheckedAt',
  'createdAt',
  'serpPosition',
  'serpBestPosition',
]);

const createSchema = z.object({
  keywords: z.array(z.string().min(1).max(255)).min(1).max(1000),
  country: z.string().max(8).optional(),
  device: z.string().max(16).optional(),
  tags: z.string().max(255).optional(),
  targetUrl: z.string().max(2000).optional(),
});

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectOwner(projectId, user.id);

    const sp = new URL(request.url).searchParams;
    const page = Math.max(1, Number(sp.get('page') ?? 1));
    const perPage = Math.min(200, Math.max(10, Number(sp.get('perPage') ?? 50)));

    const sortRaw = sp.get('sort') ?? 'lastImpressions';
    const sort = SORTABLE.has(sortRaw) ? sortRaw : 'lastImpressions';
    const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc';

    const where: Prisma.KeywordWhereInput = { projectId };

    const search = sp.get('search');
    if (search) where.normalized = { contains: normalizeKeyword(search) };

    const tracked = sp.get('tracked');
    if (tracked === 'true') where.tracked = true;
    if (tracked === 'false') where.tracked = false;

    const source = sp.get('source');
    if (source) where.source = source;

    const tag = sp.get('tag');
    if (tag) where.tags = { contains: tag };

    const bucket = sp.get('bucket');
    if (bucket === 'top3') where.lastPosition = { lte: 3 };
    if (bucket === 'top10') where.lastPosition = { lte: 10 };
    if (bucket === 'top30') where.lastPosition = { gt: 10, lte: 30 };
    if (bucket === 'rest') where.lastPosition = { gt: 30 };
    if (bucket === 'none') where.lastPosition = null;

    const [total, keywords, summary] = await Promise.all([
      prisma.keyword.count({ where }),
      prisma.keyword.findMany({
        where,
        orderBy:
          sort === 'keyword'
            ? { keyword: dir }
            : ({ [sort]: { sort: dir, nulls: 'last' } } as Prisma.KeywordOrderByWithRelationInput),
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      keywordSummary(projectId),
    ]);

    return ok({
      keywords,
      summary,
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  });
}

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectWrite(projectId, user.id);

    const body = createSchema.parse(await request.json());
    const country = normalizeCountry(body.country);
    const device = normalizeDevice(body.device);

    let created = 0;
    let skipped = 0;

    for (const raw of body.keywords) {
      if (!isValidKeyword(raw)) {
        skipped++;
        continue;
      }

      const normalized = normalizeKeyword(raw);

      const existing = await prisma.keyword.findUnique({
        where: {
          projectId_normalized_country_device: {
            projectId,
            normalized,
            country,
            device,
          },
        },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.keyword.create({
        data: {
          projectId,
          keyword: raw.trim().slice(0, 255),
          normalized,
          country,
          device,
          source: 'MANUAL',
          tags: body.tags ?? null,
          targetUrl: body.targetUrl ?? null,
        },
      });
      created++;
    }

    return ok({ created, skipped }, { status: 201 });
  });
}
