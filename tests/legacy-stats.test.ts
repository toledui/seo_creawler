import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isLegacyStats,
  requestedUrlsOf,
  type CrawlStats,
} from '../src/analysis/analyze-crawl';

/**
 * Estadísticas tal y como quedaron guardadas en `Crawl.stats` ANTES de la
 * clasificación de recursos: sin `resources`, sin `images` y sin
 * `totals.requestedUrls`. Siguen en base de datos de rastreos anteriores y
 * la interfaz tiene que poder pintarlas sin reventar.
 */
const legacy = {
  totals: {
    pages: 158,
    indexable: 97,
    nonIndexable: 61,
    errors: 2,
    redirects: 2,
    internalLinks: 1200,
    externalLinks: 80,
    averageDepth: 2.4,
    averageResponseTime: 310,
    averageWordCount: 640,
  },
  statusDistribution: { '2xx': 154, '3xx': 2, '4xx': 2 },
  depthDistribution: { '0': 1, '1': 40 },
  indexabilityDistribution: { INDEXABLE: 97 },
  issueSeverity: { MEDIUM: 120 },
  topIssues: [],
  directories: [],
  geo: { score: 55 },
  seoHealth: 61,
  architecture: {
    communities: 0,
    modularity: null,
    clusters: [],
    topBottlenecks: [],
    topHubs: [],
    topAuthorities: [],
  },
  computedAt: '2026-09-01T10:00:00.000Z',
} as unknown as CrawlStats;

describe('estadísticas anteriores a la clasificación de recursos', () => {
  it('se reconocen como antiguas', () => {
    assert.equal(isLegacyStats(legacy), true);
  });

  it('acceder a los bloques nuevos no lanza: son undefined', () => {
    assert.equal(legacy.resources, undefined);
    assert.equal(legacy.images, undefined);
  });

  it('requestedUrlsOf cae a totals.pages, que era el total de URLs', () => {
    assert.equal(requestedUrlsOf(legacy), 158);
  });

  it('unas estadísticas nuevas no se marcan como antiguas', () => {
    const fresh = {
      ...legacy,
      totals: { ...legacy.totals, pages: 97, requestedUrls: 158 },
      resources: {
        discovered: 61,
        byType: { IMAGE: 52 },
        images: 54,
        broken: 1,
        brokenImages: 1,
        brokenImagesRatio: 0.0185,
        mimeMismatches: 1,
      },
      images: {
        elements: 123,
        missingAlt: 103,
        decorativeAlt: 19,
        describedAlt: 1,
        pagesWithMissingAlt: 97,
        missingAltRatio: 0.8374,
      },
    } as CrawlStats;

    assert.equal(isLegacyStats(fresh), false);
    assert.equal(requestedUrlsOf(fresh), 158);
    assert.equal(fresh.resources?.discovered, 61);
  });
});
