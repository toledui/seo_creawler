import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logCrawl } from '../../lib/logger';
import { env } from '../../lib/env';
import { fetchPage } from './fetch-page';
import { parseHtml } from './parse-html';
import { classifyResource } from './resource-type';
import { altState } from '../seo/image-audit';
import {
  directoryOf,
  isSameSite,
  normalizeWithHash,
  urlHash,
} from './normalize-url';
import { crawlDelayOf, isAllowed, loadRobots, type RobotsInfo } from './robots';
import { defaultSitemapCandidates, discoverSitemapUrls } from './sitemap';
import { PersistentFrontier } from './frontier';
import { evaluateIndexability, isNofollowRobots } from '../seo/indexability';
import { geoSignalsForPage } from '../geo/signals';
import { simhashOf } from '../analysis/simhash';
import type { CrawlConfig, ParsedPage, QueueItem } from './types';

export type CrawlControl = 'PAUSE' | 'RESUME' | 'CANCEL' | null;

export type CrawlProgress = {
  discovered: number;
  crawled: number;
  failed: number;
};

export type CrawlRunResult = {
  status: 'COMPLETED' | 'CANCELLED' | 'PAUSED' | 'FAILED';
  progress: CrawlProgress;
  message?: string;
};

type Hooks = {
  /** Devuelve la señal de control pendiente (PAUSE/CANCEL) o null. */
  readControl: () => Promise<CrawlControl>;
  onProgress: (progress: CrawlProgress) => Promise<void>;
  onEvent: (event: string, message?: string, level?: string) => Promise<void>;
};

function matchesAny(url: string, patterns: string[]): boolean {
  return patterns.some((raw) => {
    const pattern = raw.trim();
    if (!pattern) return false;
    try {
      return new RegExp(pattern, 'i').test(url);
    } catch {
      return url.includes(pattern);
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ejecuta un crawl completo.
 *
 * Estrategia (secciones 9–11 del plan):
 *   robots.txt -> sitemaps -> BFS por enlaces con dedupe por hash SHA-256.
 *
 * La frontera vive en base de datos, así que pausar y reanudar continúa
 * donde iba. Cada página se guarda de forma idempotente (se borran sus
 * filas hijas antes de reinsertarlas), de modo que reprocesar una URL
 * nunca duplica enlaces ni falsea los inlinks.
 */
export async function runCrawl(
  config: CrawlConfig,
  hooks: Hooks,
): Promise<CrawlRunResult> {
  const { crawlId } = config;
  const userAgent = config.userAgent || env.crawler.userAgent;

  const start = normalizeWithHash(config.startUrl);
  if (!start) {
    return {
      status: 'FAILED',
      progress: { discovered: 0, crawled: 0, failed: 0 },
      message: `URL inicial inválida: ${config.startUrl}`,
    };
  }

  const origin = new URL(start.normalizedUrl).origin;

  const frontier = new PersistentFrontier(crawlId);
  const pendingFromPreviousRun = await frontier.restore();
  const resuming = pendingFromPreviousRun > 0;

  if (resuming) {
    await hooks.onEvent(
      'resume',
      `Reanudando: ${pendingFromPreviousRun} URLs pendientes en la frontera`,
    );
  }

  // ---------------------------------------------------------- robots.txt
  let robots: RobotsInfo = {
    robotsUrl: '',
    fetched: false,
    robot: null,
    sitemaps: [],
  };

  if (config.respectRobots) {
    robots = await loadRobots(origin, userAgent);
    await hooks.onEvent(
      'robots',
      robots.fetched
        ? `robots.txt cargado (${robots.sitemaps.length} sitemaps declarados)`
        : 'robots.txt no disponible, se asume acceso permitido',
    );
  }

  const robotsDelay = crawlDelayOf(robots, userAgent);
  const delayMs = Math.max(config.delayMs, robotsDelay ?? 0);

  const sitemapHashes = new Set<string>();

  if (!resuming) {
    frontier.push({
      url: start.normalizedUrl,
      normalizedUrl: start.normalizedUrl,
      hash: start.hash,
      depth: 0,
      discoveredFrom: null,
      discoveryType: 'START',
    });

    // ------------------------------------------------------- Sitemaps
    if (config.useSitemaps) {
      const seeds = robots.sitemaps.length
        ? robots.sitemaps
        : defaultSitemapCandidates(origin);

      try {
        const entries = await discoverSitemapUrls(seeds, {
          userAgent,
          maxUrls: config.maxUrls,
        });

        if (entries.length) {
          await prisma.sitemapUrl.createMany({
            data: entries.map((e) => ({
              crawlId,
              url: e.url.slice(0, 2000),
              normalizedUrl: e.normalizedUrl.slice(0, 2000),
              urlHash: e.hash,
              sitemap: e.sitemap.slice(0, 2000),
            })),
            skipDuplicates: true,
          });
        }

        for (const entry of entries) {
          sitemapHashes.add(entry.hash);
          if (frontier.discovered >= config.maxUrls) break;
          if (!isSameSite(entry.normalizedUrl, origin, config.followSubdomains)) {
            continue;
          }
          frontier.push({
            url: entry.normalizedUrl,
            normalizedUrl: entry.normalizedUrl,
            hash: entry.hash,
            depth: 0,
            discoveredFrom: entry.sitemap,
            discoveryType: 'SITEMAP',
          });
        }

        await hooks.onEvent(
          'sitemap',
          `${entries.length} URLs descubiertas vía sitemap`,
        );
      } catch (err) {
        await hooks.onEvent(
          'sitemap',
          `Error leyendo sitemaps: ${(err as Error).message}`,
          'warn',
        );
      }
    }
  } else {
    // Al reanudar recuperamos qué URLs venían del sitemap.
    const rows = await prisma.sitemapUrl.findMany({
      where: { crawlId },
      select: { urlHash: true },
    });
    for (const row of rows) sitemapHashes.add(row.urlHash);
  }

  await frontier.flush();

  // ---------------------------------------------------------- Loop BFS
  const alreadyCrawled = resuming
    ? await prisma.page.count({ where: { crawlId } })
    : 0;
  const alreadyFailed = resuming
    ? await prisma.page.count({
        where: {
          crawlId,
          OR: [{ statusCode: { gte: 400 } }, { errorType: { not: null } }],
        },
      })
    : 0;

  const progress: CrawlProgress = {
    discovered: frontier.discovered,
    crawled: alreadyCrawled,
    failed: alreadyFailed,
  };

  let stop: 'CANCELLED' | 'PAUSED' | null = null;
  let lastControlCheck = 0;
  let lastFlush = Date.now();

  async function processOne(item: QueueItem): Promise<void> {
    const blockedByRobots =
      config.respectRobots && !isAllowed(robots, item.normalizedUrl, userAgent);

    let parsed: ParsedPage | null = null;
    let result = null as Awaited<ReturnType<typeof fetchPage>> | null;

    if (!blockedByRobots) {
      result = await fetchPage(item.normalizedUrl, { userAgent });
    }

    // Antes de tocar el cuerpo decidimos QUÉ es esta URL. Sin este paso un
    // WebP de /wp-content/uploads/ acaba en las reglas de metadatos y
    // genera falsos "title ausente", "H1 ausente" o "canonical ausente".
    const classification = classifyResource({
      url: item.normalizedUrl,
      finalUrl: result?.finalUrl ?? null,
      statusCode: result?.statusCode ?? null,
      contentType: result?.contentType ?? null,
      errorType: blockedByRobots ? 'BLOCKED_ROBOTS' : result?.errorType ?? null,
      redirectChain: result?.redirectChain ?? null,
    });

    // Sólo se parsea DOM si los bytes son realmente un documento HTML:
    // nunca interpretamos binarios como texto. Una 404 con plantilla HTML
    // sí se parsea (es útil para diagnosticar), pero su `resourceType` es
    // ERROR, así que las reglas on-page no llegan a evaluarla.
    if (result?.body && classification.mediaType === 'HTML_PAGE') {
      try {
        parsed = parseHtml(result.body, result.finalUrl || item.normalizedUrl);
      } catch (err) {
        await hooks.onEvent(
          'parse_error',
          `${item.normalizedUrl}: ${(err as Error).message}`,
          'warn',
        );
      }
    }

    const xRobotsTag = result?.headers['x-robots-tag'] ?? null;
    const canonicalNormalized = parsed?.canonical
      ? normalizeWithHash(parsed.canonical)?.normalizedUrl ?? null
      : null;

    const indexability = evaluateIndexability({
      statusCode: result?.statusCode ?? null,
      metaRobots: parsed?.metaRobots ?? null,
      xRobotsTag,
      canonical: parsed?.canonical ?? null,
      normalizedUrl: item.normalizedUrl,
      canonicalNormalized,
      blockedByRobots,
      isHtml: classification.isHtmlDocument,
      hasError: Boolean(
        result?.errorType && result.errorType !== 'UNSUPPORTED_CONTENT',
      ),
    });

    const isFailure =
      blockedByRobots ||
      Boolean(result?.errorType && result.errorType !== 'UNSUPPORTED_CONTENT') ||
      (result?.statusCode ?? 0) >= 400;

    // "Sin alt" = el atributo no existe. `alt=""` es una imagen decorativa
    // declarada: se cuenta aparte como observación, no como error.
    const imagesMissingAlt =
      parsed?.images.filter((i) => altState(i) === 'MISSING').length ?? 0;
    const imagesDecorative =
      parsed?.images.filter((i) => altState(i) === 'DECORATIVE').length ?? 0;

    // Normalizamos los enlaces una sola vez y reutilizamos el resultado.
    const normalizedLinks = parsed
      ? parsed.links.map((link) => ({
          link,
          normalized: normalizeWithHash(link.href, item.normalizedUrl),
        }))
      : [];

    const internalCount = normalizedLinks.filter(
      (l) =>
        l.normalized &&
        isSameSite(l.normalized.normalizedUrl, origin, config.followSubdomains),
    ).length;

    const pageData = {
      url: item.url.slice(0, 2000),
      normalizedUrl: item.normalizedUrl.slice(0, 2000),
      urlHash: item.hash,
      finalUrl: result?.finalUrl?.slice(0, 2000) ?? null,
      redirectUrl: result?.redirectUrl?.slice(0, 2000) ?? null,
      redirectChain: (result?.redirectChain?.length
        ? result.redirectChain.slice(0, 20)
        : Prisma.DbNull) as Prisma.InputJsonValue,
      statusCode: result?.statusCode ?? null,
      contentType: result?.contentType?.slice(0, 190) ?? null,
      resourceType: classification.resourceType,
      mediaType: classification.mediaType,
      mimeType: classification.mimeType?.slice(0, 127) ?? null,
      mimeMismatch: classification.extensionMismatch,
      responseTime: result?.responseTime ?? null,
      contentLength: result?.contentLength ?? null,
      errorType: blockedByRobots ? 'BLOCKED_ROBOTS' : result?.errorType ?? null,
      title: parsed?.title ?? null,
      titleLength: parsed?.title?.length ?? null,
      metaDescription: parsed?.metaDescription ?? null,
      metaDescriptionLength: parsed?.metaDescription?.length ?? null,
      h1: parsed?.h1 ?? null,
      h1Count: parsed?.h1Count ?? 0,
      h2Count: parsed?.h2Count ?? 0,
      canonical: parsed?.canonical?.slice(0, 2000) ?? null,
      metaRobots: parsed?.metaRobots ?? null,
      xRobotsTag,
      wordCount: parsed?.wordCount ?? 0,
      language: parsed?.language?.slice(0, 190) ?? null,
      indexable: indexability.indexable,
      indexabilityReason: indexability.reason,
      depth: item.depth,
      discoveredFrom: item.discoveredFrom?.slice(0, 2000) ?? null,
      discoveryType: item.discoveryType,
      internalOutlinks: internalCount,
      externalOutlinks: normalizedLinks.length - internalCount,
      imagesCount: parsed?.images.length ?? 0,
      imagesMissingAlt,
      imagesDecorative,
      inSitemap: sitemapHashes.has(item.hash),
      directory: directoryOf(item.normalizedUrl).slice(0, 250),
      contentHash: parsed?.contentHash ?? null,
      simhash: parsed?.text ? simhashOf(parsed.text) : null,
      geoSignals: (parsed
        ? geoSignalsForPage(parsed)
        : Prisma.DbNull) as Prisma.InputJsonValue,
    };

    const page = await prisma.page.upsert({
      where: { crawlId_urlHash: { crawlId, urlHash: item.hash } },
      create: { crawlId, ...pageData },
      // Reprocesar una URL debe dejar los datos como si fuera la primera vez.
      update: pageData,
      select: { id: true },
    });

    // Idempotencia: fuera lo anterior antes de reinsertar.
    await Promise.all([
      prisma.heading.deleteMany({ where: { pageId: page.id } }),
      prisma.imageAsset.deleteMany({ where: { pageId: page.id } }),
      prisma.schemaMarkup.deleteMany({ where: { pageId: page.id } }),
      prisma.hreflang.deleteMany({ where: { pageId: page.id } }),
      prisma.link.deleteMany({ where: { sourcePageId: page.id } }),
    ]);

    if (parsed) {
      if (parsed.headings.length) {
        await prisma.heading.createMany({
          data: parsed.headings.map((h) => ({
            pageId: page.id,
            level: h.level,
            text: h.text.slice(0, 1000),
            order: h.order,
          })),
        });
      }
      if (parsed.images.length) {
        await prisma.imageAsset.createMany({
          data: parsed.images.slice(0, 200).map((i) => ({
            pageId: page.id,
            src: i.src.slice(0, 2000),
            urlHash:
              normalizeWithHash(i.src, item.normalizedUrl)?.hash ?? null,
            alt: i.alt?.slice(0, 1000) ?? null,
            hasAlt: i.hasAlt,
            srcset: i.srcset?.slice(0, 2000) ?? null,
            width: i.width,
            height: i.height,
            loading: i.loading?.slice(0, 50) ?? null,
          })),
        });
      }
      if (parsed.schemas.length) {
        await prisma.schemaMarkup.createMany({
          data: parsed.schemas.map((s) => ({
            pageId: page.id,
            schemaType: s.schemaType?.slice(0, 190) ?? null,
            rawJson: s.rawJson,
            validJson: s.validJson,
          })),
        });
      }
      if (parsed.hreflangs.length) {
        await prisma.hreflang.createMany({
          data: parsed.hreflangs.map((h) => ({
            pageId: page.id,
            href: h.href.slice(0, 2000),
            language: h.language,
          })),
        });
      }
    }

    // ---- Enlaces (se guardan por página, no al final: memoria acotada)
    const nofollowPage = isNofollowRobots(parsed?.metaRobots ?? null);
    const linkRows: Prisma.LinkCreateManyInput[] = [];
    const seenTargets = new Set<string>();

    for (const { link, normalized } of normalizedLinks) {
      if (!normalized) continue;

      const internal = isSameSite(
        normalized.normalizedUrl,
        origin,
        config.followSubdomains,
      );

      const key = `${normalized.hash}|${link.anchorText}`;
      if (!seenTargets.has(key)) {
        seenTargets.add(key);
        linkRows.push({
          crawlId,
          sourcePageId: page.id,
          targetPageId: null,
          targetUrl: normalized.normalizedUrl.slice(0, 2000),
          targetHash: normalized.hash,
          anchorText: link.anchorText.slice(0, 500) || null,
          rel: link.rel?.slice(0, 190) ?? null,
          linkType: internal ? 'INTERNAL' : 'EXTERNAL',
          follow: link.follow,
        });
      }

      if (!internal) continue;
      if (item.depth + 1 > config.maxDepth) continue;
      if (frontier.discovered >= config.maxUrls) continue;
      if (!link.follow && !config.followNofollow) continue;
      if (nofollowPage && !config.followNofollow) continue;
      if (
        config.includePatterns.length &&
        !matchesAny(normalized.normalizedUrl, config.includePatterns)
      ) {
        continue;
      }
      if (
        config.excludePatterns.length &&
        matchesAny(normalized.normalizedUrl, config.excludePatterns)
      ) {
        continue;
      }

      frontier.push({
        url: normalized.normalizedUrl,
        normalizedUrl: normalized.normalizedUrl,
        hash: normalized.hash,
        depth: item.depth + 1,
        discoveredFrom: item.normalizedUrl,
        discoveryType: 'LINK',
      });
    }

    for (let i = 0; i < linkRows.length; i += 500) {
      await prisma.link.createMany({ data: linkRows.slice(i, i + 500) });
    }

    // ---- Seguir el destino de un redirect
    if (result?.redirectUrl && item.depth <= config.maxDepth) {
      const normalized = normalizeWithHash(result.redirectUrl, item.normalizedUrl);
      if (
        normalized &&
        isSameSite(normalized.normalizedUrl, origin, config.followSubdomains) &&
        frontier.discovered < config.maxUrls
      ) {
        frontier.push({
          url: normalized.normalizedUrl,
          normalizedUrl: normalized.normalizedUrl,
          hash: normalized.hash,
          depth: item.depth,
          discoveredFrom: item.normalizedUrl,
          discoveryType: 'REDIRECT',
        });
      }
    }

    progress.crawled++;
    if (isFailure) progress.failed++;
    progress.discovered = frontier.discovered;

    logCrawl({
      crawlId,
      pageId: page.id.toString(),
      url: item.normalizedUrl,
      event: 'page_crawled',
      status: result?.statusCode ?? undefined,
      duration: result?.responseTime,
      workerId: env.worker.id,
    });
  }

  const concurrency = Math.max(
    1,
    Math.min(config.concurrency, env.crawler.maxConcurrency),
  );

  // Un mutex simple evita que dos workers saquen la misma URL del buffer.
  let takeChain: Promise<QueueItem | undefined> = Promise.resolve(undefined);
  const takeNext = (): Promise<QueueItem | undefined> => {
    takeChain = takeChain.then(() => frontier.next());
    return takeChain;
  };

  async function worker(): Promise<void> {
    for (;;) {
      if (stop) return;

      const now = Date.now();
      if (now - lastControlCheck > 1500) {
        lastControlCheck = now;
        const control = await hooks.readControl();
        if (control === 'CANCEL') {
          stop = 'CANCELLED';
          return;
        }
        if (control === 'PAUSE') {
          stop = 'PAUSED';
          return;
        }
      }

      if (progress.crawled >= config.maxUrls) return;

      const item = await takeNext();
      if (!item) return;

      if (item.depth > config.maxDepth) {
        frontier.complete(item.hash);
        continue;
      }

      try {
        await processOne(item);
      } catch (err) {
        progress.failed++;
        await hooks.onEvent(
          'page_error',
          `${item.normalizedUrl}: ${(err as Error).message}`,
          'warn',
        );
      } finally {
        // Se marca siempre, también si falló: si no, la URL volvería a la
        // cola una y otra vez y el crawl no terminaría nunca.
        frontier.complete(item.hash);
      }

      if (Date.now() - lastFlush > 1000) {
        lastFlush = Date.now();
        await frontier.flush();
        await hooks.onProgress({ ...progress });
      }

      if (delayMs > 0) await sleep(delayMs);
    }
  }

  // Un worker puede salir porque la cola quedó vacía un instante mientras
  // otro seguía descubriendo enlaces. Relanzamos mientras siga habiendo
  // trabajo pendiente en base.
  for (;;) {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (stop) break;
    if (progress.crawled >= config.maxUrls) break;
    if ((await frontier.pendingCount()) === 0) break;
  }

  await frontier.flush();
  await hooks.onProgress({ ...progress });

  if (stop === 'CANCELLED') return { status: 'CANCELLED', progress };
  if (stop === 'PAUSED') return { status: 'PAUSED', progress };
  return { status: 'COMPLETED', progress };
}

export { urlHash };
