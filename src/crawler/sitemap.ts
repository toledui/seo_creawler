import { XMLParser } from 'fast-xml-parser';
import { fetchPage } from './fetch-page';
import { normalizeWithHash } from './normalize-url';

export type SitemapEntry = {
  url: string;
  normalizedUrl: string;
  hash: string;
  sitemap: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function locOf(node: unknown): string | null {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') {
    const loc = (node as Record<string, unknown>).loc;
    if (typeof loc === 'string') return loc;
    if (typeof loc === 'number') return String(loc);
  }
  return null;
}

/**
 * Descubre URLs a partir de sitemaps.
 *
 * Acepta sitemap índices anidados (hasta `maxSitemaps` documentos) y
 * corta en `maxUrls` para no reventar memoria en sitios enormes.
 */
export async function discoverSitemapUrls(
  seeds: string[],
  options: {
    userAgent: string;
    maxUrls?: number;
    maxSitemaps?: number;
    onSitemap?: (url: string, count: number) => void;
  },
): Promise<SitemapEntry[]> {
  const maxUrls = options.maxUrls ?? 50_000;
  const maxSitemaps = options.maxSitemaps ?? 50;

  const queue = [...new Set(seeds)];
  const visited = new Set<string>();
  const found = new Map<string, SitemapEntry>();

  while (queue.length > 0 && visited.size < maxSitemaps && found.size < maxUrls) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    const res = await fetchPage(sitemapUrl, {
      userAgent: options.userAgent,
      readBody: 'always',
    });
    if (!res.body || !res.statusCode || res.statusCode >= 400) continue;

    let doc: Record<string, unknown>;
    try {
      doc = parser.parse(res.body) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Índice de sitemaps
    const index = doc.sitemapindex as Record<string, unknown> | undefined;
    if (index) {
      for (const node of asArray(index.sitemap as unknown)) {
        const loc = locOf(node);
        if (loc && !visited.has(loc)) queue.push(loc);
      }
      continue;
    }

    // Sitemap de URLs
    const urlset = doc.urlset as Record<string, unknown> | undefined;
    if (!urlset) continue;

    let added = 0;
    for (const node of asArray(urlset.url as unknown)) {
      if (found.size >= maxUrls) break;
      const loc = locOf(node);
      if (!loc) continue;
      const normalized = normalizeWithHash(loc);
      if (!normalized) continue;
      if (found.has(normalized.hash)) continue;
      found.set(normalized.hash, {
        url: loc,
        normalizedUrl: normalized.normalizedUrl,
        hash: normalized.hash,
        sitemap: sitemapUrl,
      });
      added++;
    }

    options.onSitemap?.(sitemapUrl, added);
  }

  return [...found.values()];
}

/** Ubicaciones habituales de sitemap cuando robots.txt no declara ninguna. */
export function defaultSitemapCandidates(origin: string): string[] {
  return [
    new URL('/sitemap.xml', origin).toString(),
    new URL('/sitemap_index.xml', origin).toString(),
  ];
}
