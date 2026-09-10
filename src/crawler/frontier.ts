import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { QueueItem } from './types';

const INSERT_BATCH = 500;
const LOAD_BATCH = 500;

/**
 * Frontera BFS persistida en MySQL.
 *
 * Mantiene un buffer en memoria para no ir a la base por cada URL, pero
 * todo lo descubierto acaba en `FrontierUrl`. Eso permite pausar un crawl
 * y reanudarlo exactamente donde iba, en lugar de volver a empezar desde
 * la Start URL.
 *
 * Las URLs se marcan `DONE` sólo después de procesarse, así que un worker
 * que muera a media página deja esa URL pendiente y se reintenta. El
 * guardado de páginas es idempotente, de modo que reprocesar no duplica.
 */
export class PersistentFrontier {
  private seen = new Set<string>();
  private buffer: QueueItem[] = [];
  private toInsert: QueueItem[] = [];
  private toComplete: string[] = [];
  /** URLs entregadas a un worker y aún sin marcar como DONE. */
  private inFlight = new Set<string>();
  private exhausted = false;

  constructor(private readonly crawlId: string) {}

  get discovered() {
    return this.seen.size;
  }

  get bufferedCount() {
    return this.buffer.length;
  }

  /** Carga el estado previo (URLs ya vistas y pendientes) al reanudar. */
  async restore(): Promise<number> {
    const known = await prisma.frontierUrl.findMany({
      where: { crawlId: this.crawlId },
      select: { urlHash: true },
    });
    for (const row of known) this.seen.add(row.urlHash);

    const pending = await prisma.frontierUrl.count({
      where: { crawlId: this.crawlId, state: 'PENDING' },
    });

    this.exhausted = pending === 0;
    return pending;
  }

  /** Añade una URL si no se había visto antes en este crawl. */
  push(item: QueueItem): boolean {
    if (this.seen.has(item.hash)) return false;
    this.seen.add(item.hash);
    this.buffer.push(item);
    this.toInsert.push(item);
    this.exhausted = false;
    return true;
  }

  /** Saca la siguiente URL, recargando desde la base si el buffer se vació. */
  async next(): Promise<QueueItem | undefined> {
    const buffered = this.buffer.shift();
    if (buffered) {
      this.inFlight.add(buffered.hash);
      return buffered;
    }

    if (this.exhausted) return undefined;

    // Puede haber pendientes que otro ciclo dejó en base (reanudación).
    await this.flush();
    const rows = await prisma.frontierUrl.findMany({
      where: { crawlId: this.crawlId, state: 'PENDING' },
      orderBy: [{ depth: 'asc' }, { id: 'asc' }],
      take: LOAD_BATCH,
    });

    // Las que otro worker tiene entre manos siguen PENDING en base: si no
    // las descartamos aquí, se rastrearían dos veces.
    const usable = rows.filter((row) => !this.inFlight.has(row.urlHash));

    if (usable.length === 0) {
      // Sólo damos la frontera por agotada si tampoco queda nada en vuelo.
      if (this.inFlight.size === 0) this.exhausted = true;
      return undefined;
    }

    for (const row of usable) {
      this.seen.add(row.urlHash);
      this.buffer.push({
        url: row.url,
        normalizedUrl: row.url,
        hash: row.urlHash,
        depth: row.depth,
        discoveredFrom: row.discoveredFrom,
        discoveryType: row.discoveryType as QueueItem['discoveryType'],
      });
    }

    const next = this.buffer.shift();
    if (next) this.inFlight.add(next.hash);
    return next;
  }

  /**
   * Marca una URL como procesada.
   *
   * Sigue contando como "en vuelo" hasta que el flush la escriba como DONE:
   * entre ambos momentos la fila continúa PENDING en base y sin esto una
   * recarga la devolvería a la cola y se rastrearía dos veces.
   */
  complete(hash: string) {
    this.toComplete.push(hash);
  }

  /**
   * Cuántas URLs quedan por rastrear en base.
   * Reabre la frontera si aparecen pendientes tras darla por agotada.
   */
  async pendingCount(): Promise<number> {
    await this.flush();
    const pending = await prisma.frontierUrl.count({
      where: { crawlId: this.crawlId, state: 'PENDING' },
    });
    if (pending > 0) this.exhausted = false;
    return pending;
  }

  /** Vuelca a la base las altas y las marcas de completado pendientes. */
  async flush(): Promise<void> {
    if (this.toInsert.length > 0) {
      const items = this.toInsert.splice(0, this.toInsert.length);
      for (let i = 0; i < items.length; i += INSERT_BATCH) {
        await prisma.frontierUrl.createMany({
          data: items.slice(i, i + INSERT_BATCH).map((item) => ({
            crawlId: this.crawlId,
            url: item.normalizedUrl.slice(0, 2000),
            urlHash: item.hash,
            depth: item.depth,
            discoveredFrom: item.discoveredFrom?.slice(0, 2000) ?? null,
            discoveryType: item.discoveryType,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (this.toComplete.length > 0) {
      const hashes = this.toComplete.splice(0, this.toComplete.length);
      for (let i = 0; i < hashes.length; i += INSERT_BATCH) {
        const chunk = hashes.slice(i, i + INSERT_BATCH);
        await prisma.frontierUrl.updateMany({
          where: { crawlId: this.crawlId, urlHash: { in: chunk } },
          data: { state: 'DONE' },
        });
        // Ya constan como DONE en base: dejan de estar en vuelo.
        for (const hash of chunk) this.inFlight.delete(hash);
      }
    }
  }
}

/**
 * Borra todo lo generado por un crawl previo.
 *
 * Se llama antes de un re-rastreo limpio: sin esto los enlaces, headings,
 * imágenes y schemas se insertarían otra vez y falsearían los inlinks y el
 * PageRank. Las filas hijas de `Page` caen por `onDelete: Cascade`.
 */
export async function resetCrawlData(crawlId: string): Promise<void> {
  await prisma.issue.deleteMany({ where: { crawlId } });
  await prisma.link.deleteMany({ where: { crawlId } });
  await prisma.page.deleteMany({ where: { crawlId } });
  await prisma.sitemapUrl.deleteMany({ where: { crawlId } });
  await prisma.frontierUrl.deleteMany({ where: { crawlId } });
  await prisma.crawl.update({
    where: { id: crawlId },
    data: {
      discoveredUrls: 0,
      crawledUrls: 0,
      failedUrls: 0,
      stats: Prisma.DbNull,
      resetRequested: false,
    },
  });
}
