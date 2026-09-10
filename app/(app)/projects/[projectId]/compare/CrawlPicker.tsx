'use client';

import { useRouter } from 'next/navigation';
import { formatDate, formatNumber } from '@/lib/format';

type CrawlOption = {
  id: string;
  startUrl: string;
  completedAt: string | null;
  crawledUrls: number;
};

export function CrawlPicker({
  projectId,
  crawls,
  baseId,
  targetId,
}: {
  projectId: string;
  crawls: CrawlOption[];
  baseId: string;
  targetId: string;
}) {
  const router = useRouter();

  function go(next: { base?: string; target?: string }) {
    const params = new URLSearchParams({
      base: next.base ?? baseId,
      target: next.target ?? targetId,
    });
    router.push(`/projects/${projectId}/compare?${params}`);
  }

  const label = (crawl: CrawlOption) =>
    `${formatDate(crawl.completedAt)} · ${formatNumber(crawl.crawledUrls)} URLs`;

  return (
    <div className="card flex flex-wrap items-end gap-3">
      <div>
        <label className="label">Crawl anterior (referencia)</label>
        <select
          className="input w-auto"
          value={baseId}
          onChange={(e) => go({ base: e.target.value })}
        >
          {crawls.map((crawl) => (
            <option key={crawl.id} value={crawl.id} disabled={crawl.id === targetId}>
              {label(crawl)}
            </option>
          ))}
        </select>
      </div>

      <div className="pb-2 text-muted">→</div>

      <div>
        <label className="label">Crawl actual</label>
        <select
          className="input w-auto"
          value={targetId}
          onChange={(e) => go({ target: e.target.value })}
        >
          {crawls.map((crawl) => (
            <option key={crawl.id} value={crawl.id} disabled={crawl.id === baseId}>
              {label(crawl)}
            </option>
          ))}
        </select>
      </div>

      <button
        className="btn"
        onClick={() => go({ base: targetId, target: baseId })}
        title="Intercambiar"
      >
        ⇄ Invertir
      </button>
    </div>
  );
}
