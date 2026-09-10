import { loadEnv } from '../../lib/load-env';

loadEnv();

import { prisma, retryOnConflict } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../lib/env';
import { runCrawl } from '../crawler/crawler';
import { resetCrawlData } from '../crawler/frontier';
import { analyzeCrawl } from '../analysis/analyze-crawl';
import { maybeEmailCrawlReport } from '../ai/notify';
import {
  claimNextCrawl,
  heartbeat,
  logEvent,
  readControlSignal,
  reclaimStaleCrawls,
} from '../queue/crawl-queue';
import {
  claimNextTrackingJob,
  reclaimStaleTrackingJobs,
  runTrackingJob,
  scheduleDailyJobs,
} from '../keywords/tracking';

const workerId = env.worker.id;
let shuttingDown = false;
let activeCrawlId: string | null = null;

function splitPatterns(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function processCrawl(crawlId: string) {
  activeCrawlId = crawlId;

  const crawl = await prisma.crawl.findUnique({ where: { id: crawlId } });
  if (!crawl) return;

  logger.info({ crawlId, workerId, event: 'crawl_start', url: crawl.startUrl });
  await logEvent(crawlId, 'crawl_start', `Iniciando ${crawl.startUrl}`);

  if (crawl.resetRequested) {
    await logEvent(crawlId, 'reset', 'Borrando datos del rastreo anterior');
    await resetCrawlData(crawlId);
  }

  /** Cada cuánto se persiste el avance. Ver `onProgress`. */
  const PROGRESS_WRITE_MS = Number(process.env.CRAWL_PROGRESS_WRITE_MS ?? 1000);
  const HEARTBEAT_MS = 10_000;
  let lastCrawlRowWrite = 0;

  /**
   * El latido sólo escribe si nadie ha tocado la fila hace poco.
   *
   * `onProgress` ya refresca `heartbeatAt` en cada escritura, así que
   * mientras el crawl avanza el latido no aporta nada y sí provoca que dos
   * conexiones actualicen la misma fila a la vez, que es lo que dispara el
   * error 1020 de MariaDB. Sólo hace falta durante los tramos sin progreso
   * (análisis, esperas largas), y ahí no compite con nadie.
   */
  const beat = setInterval(() => {
    if (Date.now() - lastCrawlRowWrite < HEARTBEAT_MS) return;
    lastCrawlRowWrite = Date.now();
    heartbeat(crawlId, workerId).catch(() => undefined);
  }, HEARTBEAT_MS);

  try {
    const result = await runCrawl(
      {
        crawlId,
        startUrl: crawl.startUrl,
        maxUrls: crawl.maxUrls,
        maxDepth: crawl.maxDepth,
        concurrency: crawl.concurrency,
        delayMs: crawl.delayMs,
        respectRobots: crawl.respectRobots,
        followSubdomains: crawl.followSubdomains,
        followNofollow: crawl.followNofollow,
        userAgent: crawl.userAgent || env.crawler.userAgent,
        includePatterns: splitPatterns(crawl.includePatterns),
        excludePatterns: splitPatterns(crawl.excludePatterns),
        useSitemaps: crawl.useSitemaps,
      },
      {
        readControl: async () => {
          const signal = await readControlSignal(crawlId);
          return signal === 'RESUME' ? null : signal;
        },
        onProgress: async (progress) => {
          // El progreso llega por cada página. Escribirlo todo satura la
          // fila y choca con el latido; con guardar cada segundo el panel
          // se ve igual de vivo.
          const now = Date.now();
          if (now - lastCrawlRowWrite < PROGRESS_WRITE_MS) return;
          lastCrawlRowWrite = now;

          await retryOnConflict(() =>
            prisma.crawl.update({
              where: { id: crawlId },
              data: {
                discoveredUrls: progress.discovered,
                crawledUrls: progress.crawled,
                failedUrls: progress.failed,
                heartbeatAt: new Date(),
              },
            }),
          );
        },
        onEvent: async (event, message, level) => {
          await logEvent(crawlId, event, message, level);
        },
      },
    );

    // Cifras definitivas: el throttle pudo saltarse el último onProgress.
    lastCrawlRowWrite = Date.now();
    await retryOnConflict(() =>
      prisma.crawl.update({
        where: { id: crawlId },
        data: {
          discoveredUrls: result.progress.discovered,
          crawledUrls: result.progress.crawled,
          failedUrls: result.progress.failed,
        },
      }),
    );

    if (result.status === 'COMPLETED') {
      await logEvent(crawlId, 'analysis_start', 'Calculando métricas e issues');
      await analyzeCrawl(crawlId);
    }

    await retryOnConflict(() =>
      prisma.crawl.update({
        where: { id: crawlId },
        data: {
          status: result.status,
          controlSignal: null,
          workerId: null,
          completedAt: result.status === 'PAUSED' ? null : new Date(),
          errorMessage: result.message ?? null,
        },
      }),
    );

    await logEvent(
      crawlId,
      'crawl_end',
      `${result.status} · ${result.progress.crawled} URLs rastreadas, ${result.progress.failed} con error`,
    );

    // Aviso por correo si la cuenta lo tiene activado. Un fallo de SMTP no
    // debe marcar como fallido un crawl que terminó bien.
    if (result.status === 'COMPLETED') {
      try {
        const sent = await maybeEmailCrawlReport(crawlId);
        if (sent) await logEvent(crawlId, 'email_sent', 'Resumen enviado por correo');
      } catch (err) {
        logger.warn({ crawlId, event: 'email_failed', err: String(err) });
      }
    }

    logger.info({
      crawlId,
      workerId,
      event: 'crawl_end',
      status: result.progress.crawled,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ crawlId, workerId, event: 'crawl_failed', err: message });
    await logEvent(crawlId, 'crawl_failed', message, 'error');
    // Sin reintento, un choque aquí dejaría el crawl colgado en RUNNING
    // para siempre y sin rastro del motivo del fallo.
    await retryOnConflict(() =>
      prisma.crawl.update({
        where: { id: crawlId },
        data: {
          status: 'FAILED',
          errorMessage: message.slice(0, 2000),
          completedAt: new Date(),
          workerId: null,
        },
      }),
    ).catch((updateError) => {
      logger.error({
        crawlId,
        event: 'crawl_status_write_failed',
        err: String(updateError),
      });
    });
  } finally {
    clearInterval(beat);
    activeCrawlId = null;
  }
}

/**
 * Tracking de keywords.
 *
 * Va después del crawling en la misma vuelta del bucle: los crawls tienen
 * prioridad y el tracking sólo entra cuando no hay nada que rastrear, así
 * que nunca compiten por el mismo worker.
 */
async function processTracking(): Promise<boolean> {
  const job = await claimNextTrackingJob(workerId);
  if (!job) return false;

  logger.info({
    workerId,
    event: 'tracking_start',
    projectId: job.projectId,
    date: job.date.toISOString().slice(0, 10),
  });

  const result = await runTrackingJob(job.id, { workerId });

  logger.info({
    workerId,
    event: 'tracking_end',
    projectId: job.projectId,
    status: result.status,
    matched: result.matched,
    processed: result.processed,
  });

  return true;
}

async function main() {
  logger.info({ workerId, event: 'worker_start' }, 'Worker iniciado');

  let idleTicks = 0;
  let lastScheduling = 0;

  while (!shuttingDown) {
    try {
      // Cada ~30s recuperamos trabajos cuyo worker murió a medias.
      if (idleTicks % 15 === 0) {
        const reclaimed = await reclaimStaleCrawls();
        if (reclaimed > 0) {
          logger.warn({ workerId, event: 'reclaim', count: reclaimed });
        }
        const reclaimedJobs = await reclaimStaleTrackingJobs();
        if (reclaimedJobs > 0) {
          logger.warn({ workerId, event: 'reclaim_tracking', count: reclaimedJobs });
        }
      }

      // Una vez cada 30 minutos programamos los jobs del día.
      if (Date.now() - lastScheduling > 30 * 60_000) {
        lastScheduling = Date.now();
        const created = await scheduleDailyJobs();
        if (created > 0) {
          logger.info({ workerId, event: 'tracking_scheduled', count: created });
        }
      }

      const crawl = await claimNextCrawl(workerId);

      if (crawl) {
        idleTicks = 0;
        await processCrawl(crawl.id);
        continue;
      }

      // Sin crawls pendientes: aprovechamos para el tracking de keywords.
      if (await processTracking()) {
        idleTicks = 0;
        continue;
      }

      idleTicks++;
      await new Promise((r) => setTimeout(r, env.worker.pollMs));
    } catch (err) {
      logger.error({ workerId, event: 'worker_error', err: String(err) });
      await new Promise((r) => setTimeout(r, env.worker.pollMs));
    }
  }

  await prisma.$disconnect();
  logger.info({ workerId, event: 'worker_stop' });
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    logger.info(
      { workerId, event: 'worker_shutdown', crawlId: activeCrawlId ?? undefined },
      'Cerrando worker, espera a que termine el crawl activo…',
    );
  });
}

main().catch((err) => {
  logger.error({ workerId, err: String(err) }, 'Worker terminó con error');
  process.exit(1);
});
