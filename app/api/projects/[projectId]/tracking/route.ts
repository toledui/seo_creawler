import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import {
  discoverRankingKeywords,
  scheduledTimeFor,
  startOfUtcDay,
  trackingConfig,
} from '@/src/keywords/tracking';
import { accountConnected } from '@/src/keywords/gsc-client';

type Params = { params: Promise<{ projectId: string }> };

export const maxDuration = 300;

const schema = z.object({
  action: z.enum(['run-now', 'discover']),
  days: z.number().int().min(1).max(480).optional(),
  minImpressions: z.number().int().min(0).max(10_000).optional(),
  limit: z.number().int().min(1).max(25_000).optional(),
});

/** Estado del tracking diario: últimos jobs, configuración y próxima ejecución. */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectOwner(projectId, user.id);

    const today = startOfUtcDay(new Date());

    const [jobs, project, trackedCount, connected] = await Promise.all([
      prisma.trackingJob.findMany({
        where: { projectId },
        orderBy: { date: 'desc' },
        take: 14,
      }),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { gscSiteUrl: true },
      }),
      prisma.keyword.count({ where: { projectId, tracked: true } }),
      accountConnected(user.id),
    ]);

    const lastSync = await prisma.trackingJob.findFirst({
      where: { projectId, status: 'COMPLETED' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });

    return ok({
      jobs,
      trackedCount,
      connected: connected && Boolean(project?.gscSiteUrl),
      connection: project?.gscSiteUrl
        ? {
            siteUrl: project.gscSiteUrl,
            lastSyncAt: lastSync?.finishedAt ?? null,
            lastError: null,
            createdAt: null,
          }
        : null,
      config: {
        batchSize: trackingConfig.batchSize,
        batchDelayMs: trackingConfig.batchDelayMs,
        windowStartHour: trackingConfig.windowStartHour,
        gscLagDays: trackingConfig.gscLagDays,
      },
      nextRunAt: scheduledTimeFor(projectId, today),
    });
  });
}

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectWrite(projectId, user.id);

    const body = schema.parse(await request.json());

    const [connected, project] = await Promise.all([
      accountConnected(user.id),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { gscSiteUrl: true },
      }),
    ]);

    if (!connected) {
      return fail(
        'Tu cuenta no está conectada a Search Console. Conéctala desde Ajustes.',
        409,
      );
    }

    if (!project?.gscSiteUrl) {
      return fail(
        'Este proyecto no tiene propiedad de Search Console seleccionada.',
        409,
      );
    }

    if (body.action === 'discover') {
      // Descubre las keywords por las que el sitio ya rankea.
      const result = await discoverRankingKeywords(projectId, {
        days: body.days ?? 28,
        minImpressions: body.minImpressions ?? 1,
        limit: body.limit ?? 5000,
      });
      return ok({ result });
    }

    // run-now: adelanta el job de hoy en lugar de ejecutarlo en el request.
    const today = startOfUtcDay(new Date());

    const job = await prisma.trackingJob.upsert({
      where: { projectId_date: { projectId, date: today } },
      create: {
        projectId,
        date: today,
        status: 'PENDING',
        scheduledFor: new Date(),
        keywordsTotal: await prisma.keyword.count({
          where: { projectId, tracked: true },
        }),
      },
      update: {
        status: 'PENDING',
        scheduledFor: new Date(),
        workerId: null,
        error: null,
        keywordsProcessed: 0,
      },
    });

    return ok({ job });
  });
}
