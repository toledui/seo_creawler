import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../lib/env';
import { accountConnected, fetchSearchAnalytics, GscError } from './gsc-client';
import { normalizeCountry, normalizeDevice, normalizeKeyword } from './normalize';
import { serplifyConfig } from '../serp/serplify-client';
import { checkKeywords, trackableKeywordIds } from '../serp/serp-tracking';

/**
 * Tracking diario de posiciones.
 *
 * Reglas de carga (el requisito era "que no sature nuestro servidor"):
 *
 * 1. **Un job por proyecto y día**, no por keyword. Search Console
 *    devuelve hasta 25.000 filas por llamada, así que un proyecto entero
 *    se resuelve normalmente con 1–2 peticiones.
 * 2. **Escalonado por proyecto**: la hora de ejecución se deriva del hash
 *    del projectId, así que 100 proyectos se reparten por la ventana en
 *    lugar de dispararse todos a la vez.
 * 3. **Escritura por lotes** con pausa entre lotes, para no bloquear la
 *    base mientras el worker también rastrea.
 * 4. **Reanudable e idempotente**: si el worker muere, el job vuelve a
 *    PENDING y el `upsert` por (keyword, día) evita duplicados.
 * 5. **Nunca se repite un día ya completado** (índice único proyecto+día).
 */

export const TRACKING_BATCH_SIZE = Number(
  process.env.TRACKING_BATCH_SIZE ?? 200,
);
export const TRACKING_BATCH_DELAY_MS = Number(
  process.env.TRACKING_BATCH_DELAY_MS ?? 250,
);
/** Hora local (0-23) a partir de la cual se puede lanzar el tracking. */
export const TRACKING_WINDOW_START_HOUR = Number(
  process.env.TRACKING_HOUR ?? 4,
);
/** Search Console publica los datos "final" con ~3 días de retraso. */
export const GSC_LAG_DAYS = Number(process.env.GSC_LAG_DAYS ?? 3);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Minuto del día en que le toca a este proyecto, estable en el tiempo. */
function offsetMinutesFor(projectId: string): number {
  const digest = createHash('sha256').update(projectId).digest();
  // Repartimos dentro de una ventana de 4 horas desde la hora configurada.
  return digest.readUInt16BE(0) % (4 * 60);
}

/** Momento en que debe ejecutarse el tracking de un proyecto para un día. */
export function scheduledTimeFor(projectId: string, date: Date): Date {
  const scheduled = new Date(date);
  scheduled.setUTCHours(TRACKING_WINDOW_START_HOUR, 0, 0, 0);
  scheduled.setUTCMinutes(scheduled.getUTCMinutes() + offsetMinutesFor(projectId));
  return scheduled;
}

/**
 * Crea los jobs del día para los proyectos que tienen keywords activas.
 * Es idempotente: el índice único (projectId, date) evita duplicarlos.
 */
export async function scheduleDailyJobs(now = new Date()): Promise<number> {
  const today = startOfUtcDay(now);

  const projects = await prisma.project.findMany({
    where: { keywords: { some: { tracked: true } } },
    select: { id: true, _count: { select: { keywords: true } } },
  });

  let created = 0;

  for (const project of projects) {
    const existing = await prisma.trackingJob.findUnique({
      where: { projectId_date: { projectId: project.id, date: today } },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.trackingJob.create({
      data: {
        projectId: project.id,
        date: today,
        status: 'PENDING',
        keywordsTotal: project._count.keywords,
        scheduledFor: scheduledTimeFor(project.id, today),
      },
    });
    created++;
  }

  return created;
}

/** Toma el siguiente job cuya hora ya ha llegado, de forma atómica. */
export async function claimNextTrackingJob(workerId: string) {
  const candidate = await prisma.trackingJob.findFirst({
    where: { status: 'PENDING', scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
    select: { id: true },
  });

  if (!candidate) return null;

  const claimed = await prisma.trackingJob.updateMany({
    where: { id: candidate.id, status: 'PENDING' },
    data: {
      status: 'RUNNING',
      workerId,
      heartbeatAt: new Date(),
      startedAt: new Date(),
    },
  });

  if (claimed.count === 0) return null;

  return prisma.trackingJob.findUnique({ where: { id: candidate.id } });
}

/** Devuelve a PENDING los jobs cuyo worker dejó de latir. */
export async function reclaimStaleTrackingJobs(staleMs = 10 * 60_000) {
  const result = await prisma.trackingJob.updateMany({
    where: {
      status: 'RUNNING',
      OR: [
        { heartbeatAt: null },
        { heartbeatAt: { lt: new Date(Date.now() - staleMs) } },
      ],
    },
    data: { status: 'PENDING', workerId: null },
  });
  return result.count;
}

export type TrackingRunResult = {
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  matched: number;
  processed: number;
  message?: string;
};

/**
 * Ejecuta el tracking de un proyecto para un día.
 *
 * Trae de Search Console todas las consultas del día y cruza sólo las que
 * el usuario tiene marcadas como tracked; las nuevas que aparezcan se
 * pueden descubrir aparte con `discoverRankingKeywords`.
 */
export async function runTrackingJob(
  jobId: string,
  options: { workerId: string } ,
): Promise<TrackingRunResult> {
  const job = await prisma.trackingJob.findUnique({
    where: { id: jobId },
    include: { project: { select: { userId: true, gscSiteUrl: true } } },
  });

  if (!job) return { status: 'FAILED', matched: 0, processed: 0, message: 'Job no encontrado' };

  const { userId, gscSiteUrl } = job.project;
  const connected = await accountConnected(userId);

  if (!gscSiteUrl || !connected) {
    // Sin Search Console todavía puede haber medición de posiciones con
    // Serplify, que no depende de esa conexión.
    const serpOnly = await runSerpTracking(job.projectId, job.date);

    await prisma.trackingJob.update({
      where: { id: jobId },
      data: {
        status: serpOnly.ran ? 'COMPLETED' : 'SKIPPED',
        finishedAt: new Date(),
        workerId: null,
        error: serpOnly.ran
          ? null
          : connected
            ? 'El proyecto no tiene propiedad de Search Console seleccionada'
            : 'La cuenta no está conectada a Search Console',
      },
    });

    return {
      status: serpOnly.ran ? 'COMPLETED' : 'SKIPPED',
      matched: serpOnly.found,
      processed: serpOnly.checked,
      message: serpOnly.ran
        ? `Sólo Serplify: ${serpOnly.checked} keywords medidas`
        : 'Sin conexión a Search Console',
    };
  }

  // Los datos "final" de GSC llegan con retraso: medimos ese día.
  const target = new Date(job.date);
  target.setUTCDate(target.getUTCDate() - GSC_LAG_DAYS);
  const isoDate = toIsoDate(target);

  try {
    const rows = await fetchSearchAnalytics(userId, {
      siteUrl: gscSiteUrl,
      startDate: isoDate,
      endDate: isoDate,
      dimensions: ['query', 'page'],
    });

    // Nos quedamos con la mejor posición por consulta.
    const byQuery = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = normalizeKeyword(row.query);
      const current = byQuery.get(key);
      if (!current || row.position < current.position) byQuery.set(key, row);
    }

    const tracked = await prisma.keyword.findMany({
      where: { projectId: job.projectId, tracked: true },
      select: {
        id: true,
        normalized: true,
        lastPosition: true,
        bestPosition: true,
      },
    });

    await prisma.trackingJob.update({
      where: { id: jobId },
      data: { keywordsTotal: tracked.length, heartbeatAt: new Date() },
    });

    const day = startOfUtcDay(target);
    let processed = 0;
    let matched = 0;

    for (let i = 0; i < tracked.length; i += TRACKING_BATCH_SIZE) {
      const batch = tracked.slice(i, i + TRACKING_BATCH_SIZE);

      for (const keyword of batch) {
        const row = byQuery.get(keyword.normalized);
        processed++;

        if (!row) {
          // No apareció ese día: se registra como "sin datos", que es
          // información útil (no es lo mismo que posición 0).
          await prisma.keywordRanking.upsert({
            where: { keywordId_date: { keywordId: keyword.id, date: day } },
            create: {
              keywordId: keyword.id,
              date: day,
              position: null,
              clicks: 0,
              impressions: 0,
              ctr: 0,
              source: 'GSC',
            },
            update: {},
          });
          continue;
        }

        matched++;

        await prisma.keywordRanking.upsert({
          where: { keywordId_date: { keywordId: keyword.id, date: day } },
          create: {
            keywordId: keyword.id,
            date: day,
            position: row.position,
            clicks: Math.round(row.clicks),
            impressions: Math.round(row.impressions),
            ctr: row.ctr,
            url: row.page,
            source: 'GSC',
          },
          update: {
            position: row.position,
            clicks: Math.round(row.clicks),
            impressions: Math.round(row.impressions),
            ctr: row.ctr,
            url: row.page,
            source: 'GSC',
          },
        });

        await prisma.keyword.update({
          where: { id: keyword.id },
          data: {
            previousPosition: keyword.lastPosition,
            lastPosition: row.position,
            bestPosition:
              keyword.bestPosition == null
                ? row.position
                : Math.min(keyword.bestPosition, row.position),
            lastClicks: Math.round(row.clicks),
            lastImpressions: Math.round(row.impressions),
            lastCtr: row.ctr,
            lastUrl: row.page,
            lastCheckedAt: new Date(),
          },
        });
      }

      await prisma.trackingJob.update({
        where: { id: jobId },
        data: { keywordsProcessed: processed, heartbeatAt: new Date() },
      });

      // Respiro entre lotes: el worker también rastrea webs.
      if (TRACKING_BATCH_DELAY_MS > 0) await sleep(TRACKING_BATCH_DELAY_MS);
    }

    // Posiciones reales con Serplify, si el proyecto lo tiene activado.
    const serp = await runSerpTracking(job.projectId, job.date);

    await prisma.trackingJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        keywordsProcessed: processed,
        finishedAt: new Date(),
        workerId: null,
        error: serp.error,
      },
    });

    logger.info({
      event: 'tracking_completed',
      serpChecked: serp.checked,
      serpCost: serp.costUsd,
      projectId: job.projectId,
      date: isoDate,
      matched,
      processed,
      workerId: options.workerId,
    });

    return { status: 'COMPLETED', matched, processed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await prisma.trackingJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        error: message.slice(0, 2000),
        finishedAt: new Date(),
        workerId: null,
      },
    });

    if (err instanceof GscError) {
      await prisma.gscAccount.updateMany({
        where: { userId },
        data: { lastError: message.slice(0, 2000) },
      });
    }

    return { status: 'FAILED', matched: 0, processed: 0, message };
  }
}

/**
 * Descubre las keywords por las que el sitio YA rankea y las da de alta.
 *
 * Es el "detectar" del requisito: en lugar de que el usuario adivine qué
 * medir, se traen las consultas reales de los últimos N días y se
 * registran las que superen un mínimo de impresiones.
 */
export async function discoverRankingKeywords(
  projectId: string,
  options: {
    days?: number;
    minImpressions?: number;
    limit?: number;
    track?: boolean;
  } = {},
): Promise<{ created: number; updated: number; scanned: number }> {
  const days = options.days ?? 28;
  const minImpressions = options.minImpressions ?? 1;
  const limit = options.limit ?? 5000;
  const track = options.track ?? true;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, gscSiteUrl: true },
  });
  if (!project?.gscSiteUrl) {
    throw new GscError(
      'El proyecto no tiene propiedad de Search Console seleccionada',
    );
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - GSC_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  const rows = await fetchSearchAnalytics(project.userId, {
    siteUrl: project.gscSiteUrl,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    dimensions: ['query', 'page'],
    rowLimit: 25_000,
  });

  const importRecord = await prisma.keywordImport.create({
    data: { projectId, source: 'GSC', status: 'RUNNING', totalRows: rows.length },
  });

  // Mejor posición por consulta en el periodo.
  const byQuery = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.impressions < minImpressions) continue;
    const key = normalizeKeyword(row.query);
    const current = byQuery.get(key);
    if (!current || row.position < current.position) byQuery.set(key, row);
  }

  const entries = [...byQuery.entries()]
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, limit);

  let created = 0;
  let updated = 0;

  for (let i = 0; i < entries.length; i += TRACKING_BATCH_SIZE) {
    const batch = entries.slice(i, i + TRACKING_BATCH_SIZE);

    for (const [normalized, row] of batch) {
      const country = normalizeCountry(row.country);
      const device = normalizeDevice(row.device);

      const existing = await prisma.keyword.findUnique({
        where: {
          projectId_normalized_country_device: {
            projectId,
            normalized,
            country,
            device,
          },
        },
        select: { id: true, bestPosition: true, lastPosition: true },
      });

      const metrics = {
        lastPosition: row.position,
        lastClicks: Math.round(row.clicks),
        lastImpressions: Math.round(row.impressions),
        lastCtr: row.ctr,
        lastUrl: row.page,
        lastCheckedAt: new Date(),
      };

      if (existing) {
        await prisma.keyword.update({
          where: { id: existing.id },
          data: {
            ...metrics,
            previousPosition: existing.lastPosition,
            bestPosition:
              existing.bestPosition == null
                ? row.position
                : Math.min(existing.bestPosition, row.position),
          },
        });
        updated++;
      } else {
        await prisma.keyword.create({
          data: {
            projectId,
            keyword: row.query.slice(0, 255),
            normalized,
            country,
            device,
            source: 'GSC',
            tracked: track,
            targetUrl: row.page,
            bestPosition: row.position,
            ...metrics,
          },
        });
        created++;
      }
    }

    if (TRACKING_BATCH_DELAY_MS > 0) await sleep(TRACKING_BATCH_DELAY_MS);
  }

  await prisma.keywordImport.update({
    where: { id: importRecord.id },
    data: {
      status: 'COMPLETED',
      createdRows: created,
      updatedRows: updated,
      skippedRows: rows.length - entries.length,
      finishedAt: new Date(),
    },
  });

  return { created, updated, scanned: rows.length };
}

export const trackingConfig = {
  batchSize: TRACKING_BATCH_SIZE,
  batchDelayMs: TRACKING_BATCH_DELAY_MS,
  windowStartHour: TRACKING_WINDOW_START_HOUR,
  gscLagDays: GSC_LAG_DAYS,
  workerId: env.worker.id,
};

/**
 * Medición de posiciones con Serplify dentro del job diario.
 *
 * Va aparte de Search Console a propósito: son fuentes distintas y el
 * fallo de una no debe tumbar la otra. Cada consulta cuesta dinero, así
 * que sólo corre si el proyecto lo tiene activado explícitamente.
 */
async function runSerpTracking(
  projectId: string,
  date: Date,
): Promise<{
  ran: boolean;
  checked: number;
  found: number;
  costUsd: number;
  error: string | null;
}> {
  const idle = { ran: false, checked: 0, found: 0, costUsd: 0, error: null };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { serpTrackingEnabled: true },
  });

  if (!project?.serpTrackingEnabled) return idle;

  const config = await serplifyConfig();
  if (!config) return idle;

  const keywordIds = await trackableKeywordIds(projectId);
  if (keywordIds.length === 0) return idle;

  try {
    const result = await checkKeywords(keywordIds, { date });

    return {
      ran: true,
      checked: result.checked,
      found: result.found,
      costUsd: result.costUsd,
      error: result.outOfBalance
        ? 'Saldo de Serplify agotado durante la medición'
        : result.errors[0] ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ event: 'serp_tracking_failed', projectId, err: message });
    return { ...idle, error: `Serplify: ${message}`.slice(0, 500) };
  }
}
