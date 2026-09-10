import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { normalizeUrl } from '@/src/crawler/normalize-url';
import { enqueueCrawl } from '@/src/queue/crawl-queue';
import { env } from '@/lib/env';

type Params = { params: Promise<{ projectId: string }> };

const createSchema = z.object({
  startUrl: z.string().min(4).optional(),
  maxUrls: z.number().int().min(1).max(200_000).default(10_000),
  maxDepth: z.number().int().min(0).max(50).default(10),
  concurrency: z.number().int().min(1).max(50).default(10),
  delayMs: z.number().int().min(0).max(10_000).default(100),
  respectRobots: z.boolean().default(true),
  followSubdomains: z.boolean().default(false),
  followNofollow: z.boolean().default(false),
  useSitemaps: z.boolean().default(true),
  userAgent: z.string().max(500).optional(),
  includePatterns: z.string().max(4000).optional(),
  excludePatterns: z.string().max(4000).optional(),
  start: z.boolean().default(true),
});

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectOwner(projectId, user.id);

    const crawls = await prisma.crawl.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return ok({ crawls });
  });
}

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    const project = await assertProjectWrite(projectId, user.id);

    const body = createSchema.parse(await request.json());

    const startUrl = normalizeUrl(body.startUrl || project.domain);
    if (!startUrl) return fail('La URL inicial no es válida', 422);

    const crawl = await prisma.crawl.create({
      data: {
        projectId,
        startUrl,
        maxUrls: body.maxUrls,
        maxDepth: body.maxDepth,
        concurrency: Math.min(body.concurrency, env.crawler.maxConcurrency),
        delayMs: body.delayMs,
        respectRobots: body.respectRobots,
        followSubdomains: body.followSubdomains,
        followNofollow: body.followNofollow,
        useSitemaps: body.useSitemaps,
        userAgent: body.userAgent?.trim() || null,
        includePatterns: body.includePatterns?.trim() || null,
        excludePatterns: body.excludePatterns?.trim() || null,
        status: 'PENDING',
      },
    });

    // El request web sólo encola: el rastreo lo ejecuta el worker (4.1).
    if (body.start) await enqueueCrawl(crawl.id);

    return ok({ crawl }, { status: 201 });
  });
}
