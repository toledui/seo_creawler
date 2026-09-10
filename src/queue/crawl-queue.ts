import { prisma, retryOnConflict } from '../../lib/prisma';

/**
 * Cola de crawls respaldada por MySQL.
 *
 * El plan original propone Redis + BullMQ. Como el entorno de este MVP
 * corre sin Docker y sin Redis instalado, la cola vive en la tabla `Crawl`:
 * el estado QUEUED es el "job pendiente" y `workerId` + `heartbeatAt`
 * hacen de lock. La interfaz es la misma (enqueue / claim / control),
 * así que sustituirla por BullMQ más adelante es un cambio local.
 */

/**
 * Marca un crawl como encolado.
 *
 * `reset: true` pide al worker que borre los datos del rastreo anterior
 * antes de empezar (re-rastreo limpio). `reset: false` deja la frontera
 * intacta, que es lo que permite reanudar un crawl pausado donde iba.
 */
export async function enqueueCrawl(
  crawlId: string,
  options: { reset?: boolean } = {},
) {
  return prisma.crawl.update({
    where: { id: crawlId },
    data: {
      status: 'QUEUED',
      controlSignal: null,
      workerId: null,
      errorMessage: null,
      completedAt: null,
      resetRequested: options.reset ?? false,
    },
  });
}

/**
 * Toma el siguiente crawl encolado de forma atómica.
 * `updateMany` sobre el id concreto garantiza que sólo un worker gane.
 */
export async function claimNextCrawl(workerId: string) {
  const candidate = await prisma.crawl.findFirst({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!candidate) return null;

  const claimed = await prisma.crawl.updateMany({
    where: { id: candidate.id, status: 'QUEUED' },
    data: {
      status: 'RUNNING',
      workerId,
      heartbeatAt: new Date(),
      startedAt: new Date(),
      controlSignal: null,
    },
  });

  if (claimed.count === 0) return null;

  return prisma.crawl.findUnique({ where: { id: candidate.id } });
}

/** Devuelve crawls RUNNING cuyo worker dejó de latir (proceso caído). */
export async function reclaimStaleCrawls(staleMs = 60_000) {
  const threshold = new Date(Date.now() - staleMs);
  const result = await prisma.crawl.updateMany({
    where: {
      status: 'RUNNING',
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: threshold } }],
    },
    data: { status: 'QUEUED', workerId: null },
  });
  return result.count;
}

export async function signalCrawl(
  crawlId: string,
  signal: 'PAUSE' | 'RESUME' | 'CANCEL',
) {
  // Pausar o cancelar ocurre mientras el worker está escribiendo progreso
  // en esta misma fila.
  return retryOnConflict(() =>
    prisma.crawl.update({
      where: { id: crawlId },
      data: { controlSignal: signal },
    }),
  );
}

export async function readControlSignal(crawlId: string) {
  const row = await prisma.crawl.findUnique({
    where: { id: crawlId },
    select: { controlSignal: true },
  });
  return (row?.controlSignal ?? null) as 'PAUSE' | 'RESUME' | 'CANCEL' | null;
}

export async function heartbeat(crawlId: string, workerId: string) {
  await retryOnConflict(() =>
    prisma.crawl.updateMany({
      where: { id: crawlId, workerId },
      data: { heartbeatAt: new Date() },
    }),
  );
}

export async function logEvent(
  crawlId: string,
  event: string,
  message?: string,
  level: string = 'info',
) {
  await prisma.crawlEvent.create({
    data: { crawlId, event, message: message?.slice(0, 2000) ?? null, level },
  });
}
