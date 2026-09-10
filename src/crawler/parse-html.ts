import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import type {
  ExtractedHeading,
  ExtractedHreflang,
  ExtractedImage,
  ExtractedLink,
  ExtractedSchema,
  ParsedPage,
} from './types';

const IGNORED_TEXT_TAGS = 'script, style, noscript, template, svg, iframe';

function clean(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length ? trimmed : null;
}

function intAttr(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** Extrae `@type` de un bloque JSON-LD, que puede ser objeto, array o @graph. */
function schemaTypesOf(parsed: unknown): string[] {
  const types: string[] = [];

  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 4) return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') types.push(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.push(x));
    if (Array.isArray(obj['@graph'])) visit(obj['@graph'], depth + 1);
  };

  visit(parsed);
  return types;
}

/**
 * Extrae toda la información SEO de un documento HTML.
 * No usa IA: todo es determinístico (principio 4.2 del plan).
 */
export function parseHtml(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);

  // ---------------------------------------------------------- Metadatos
  const title = clean($('head > title').first().text() || $('title').first().text());

  const metaDescription = clean(
    $('meta[name="description"]').attr('content') ??
      $('meta[property="og:description"]').attr('content'),
  );

  const metaRobots = clean(
    $('meta[name="robots"]').attr('content') ??
      $('meta[name="googlebot"]').attr('content'),
  );

  const canonicalRaw = clean($('link[rel="canonical"]').attr('content') ?? $('link[rel="canonical"]').attr('href'));
  let canonical: string | null = null;
  if (canonicalRaw) {
    try {
      canonical = new URL(canonicalRaw, pageUrl).toString();
    } catch {
      canonical = canonicalRaw;
    }
  }

  const language =
    clean($('html').attr('lang')) ??
    clean($('meta[http-equiv="content-language"]').attr('content'));

  // ---------------------------------------------------------- Headings
  const headings: ExtractedHeading[] = [];
  let order = 0;
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName ?? '';
    const level = parseInt(tag.replace(/\D/g, ''), 10);
    const text = clean($(el).text());
    if (!Number.isFinite(level) || !text) return;
    headings.push({ level, text, order: order++ });
  });

  const h1s = headings.filter((h) => h.level === 1);
  const h2s = headings.filter((h) => h.level === 2);

  // ---------------------------------------------------------- Contenido
  const $body = $('body').clone();
  $body.find(IGNORED_TEXT_TAGS).remove();
  const text = $body.text().replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const contentHash = text ? createHash('sha256').update(text).digest('hex') : null;
  const textRatio = html.length > 0 ? Number((text.length / html.length).toFixed(4)) : 0;

  // ---------------------------------------------------------- Links
  const links: ExtractedLink[] = [];
  let externalCitations = 0;
  let pageHost = '';
  try {
    pageHost = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    /* noop */
  }

  $('a[href]').each((_, el) => {
    const $el = $(el);
    const href = ($el.attr('href') ?? '').trim();
    if (!href) return;

    const rel = clean($el.attr('rel'));
    const relTokens = (rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const follow = !relTokens.includes('nofollow');

    const anchorText =
      clean($el.text()) ??
      clean($el.find('img').first().attr('alt')) ??
      clean($el.attr('title')) ??
      '';

    links.push({ href, anchorText: anchorText ?? '', rel, follow });

    try {
      const host = new URL(href, pageUrl).hostname.replace(/^www\./, '');
      if (pageHost && host && host !== pageHost) externalCitations++;
    } catch {
      /* noop */
    }
  });

  // ---------------------------------------------------------- Imágenes
  const images: ExtractedImage[] = [];
  $('img').each((_, el) => {
    const $el = $(el);
    const src = ($el.attr('src') ?? $el.attr('data-src') ?? '').trim();
    if (!src) return;
    let absolute = src;
    try {
      absolute = new URL(src, pageUrl).toString();
    } catch {
      /* dejamos el valor original */
    }
    images.push({
      src: absolute,
      alt: $el.attr('alt') ?? null,
      width: intAttr($el.attr('width')),
      height: intAttr($el.attr('height')),
      loading: clean($el.attr('loading')),
    });
  });

  // ---------------------------------------------------------- JSON-LD
  const schemas: ExtractedSchema[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    const truncated = raw.length > 60_000 ? raw.slice(0, 60_000) : raw;
    try {
      const parsed = JSON.parse(raw);
      const types = schemaTypesOf(parsed);
      if (types.length === 0) {
        schemas.push({ schemaType: null, rawJson: truncated, validJson: true });
      } else {
        for (const t of types) {
          schemas.push({ schemaType: t, rawJson: truncated, validJson: true });
        }
      }
    } catch {
      schemas.push({ schemaType: null, rawJson: truncated, validJson: false });
    }
  });

  // ---------------------------------------------------------- Hreflang
  const hreflangs: ExtractedHreflang[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const $el = $(el);
    const href = clean($el.attr('href'));
    const lang = clean($el.attr('hreflang'));
    if (!href || !lang) return;
    let absolute = href;
    try {
      absolute = new URL(href, pageUrl).toString();
    } catch {
      /* noop */
    }
    hreflangs.push({ href: absolute, language: lang.slice(0, 32) });
  });

  // ---------------------------------------------------------- Señales GEO
  const schemaTypes = schemas.map((s) => (s.schemaType ?? '').toLowerCase());
  const hasAuthor =
    $('[rel="author"]').length > 0 ||
    $('meta[name="author"]').length > 0 ||
    $('[itemprop="author"]').length > 0 ||
    schemaTypes.includes('person') ||
    schemas.some((s) => s.rawJson.includes('"author"'));

  const publishedDate =
    clean($('meta[property="article:published_time"]').attr('content')) ??
    clean($('time[datetime]').first().attr('datetime'));

  const modifiedDate =
    clean($('meta[property="article:modified_time"]').attr('content')) ??
    clean($('meta[name="last-modified"]').attr('content'));

  return {
    title,
    metaDescription,
    metaRobots,
    canonical,
    language,
    h1: h1s[0]?.text ?? null,
    h1Count: h1s.length,
    h2Count: h2s.length,
    wordCount,
    contentHash,
    text,
    headings: headings.slice(0, 200),
    links,
    images: images.slice(0, 500),
    schemas: schemas.slice(0, 50),
    hreflangs: hreflangs.slice(0, 100),
    hasAuthor,
    publishedDate,
    modifiedDate,
    externalCitations,
    textRatio,
  };
}
