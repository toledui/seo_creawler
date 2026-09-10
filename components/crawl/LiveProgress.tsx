'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDuration, formatNumber } from '@/lib/format';

type Snapshot = {
  crawl: {
    status: string;
    discoveredUrls: number;
    crawledUrls: number;
    failedUrls: number;
    maxUrls: number;
  };
  metrics: { elapsedSeconds: number; urlsPerMinute: number; pending: number };
  events: { id: string; event: string; message: string | null; level: string }[];
};

const ACTIVE = ['RUNNING', 'QUEUED', 'PENDING'];

/** Panel de progreso en vivo: hace polling mientras el crawl esté activo. */
export function LiveProgress({
  crawlId,
  initialStatus,
}: {
  crawlId: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/crawls/${crawlId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as Snapshot;
        if (cancelled) return;

        setData(body);

        if (body.crawl.status !== status) {
          setStatus(body.crawl.status);
          // Al terminar, recargamos la vista para traer métricas e issues.
          if (!ACTIVE.includes(body.crawl.status)) router.refresh();
        }
      } catch {
        /* reintentamos en el siguiente tick */
      }
    }

    tick();
    if (!ACTIVE.includes(status)) return;

    const timer = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [crawlId, status, router]);

  if (!ACTIVE.includes(status) && !data) return null;
  if (!ACTIVE.includes(status)) return null;

  const crawl = data?.crawl;
  const metrics = data?.metrics;

  const progress =
    crawl && crawl.discoveredUrls > 0
      ? Math.min(100, Math.round((crawl.crawledUrls / crawl.discoveredUrls) * 100))
      : 0;

  return (
    <div className="card space-y-3 border-accent/40">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-accent">
          {status === 'QUEUED' || status === 'PENDING'
            ? 'En cola — esperando al worker'
            : 'Rastreo en curso'}
        </span>
        <span className="text-xs text-muted">actualizando cada 2,5s</span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded bg-panel2">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <Metric label="Encontradas" value={formatNumber(crawl?.discoveredUrls ?? 0)} />
        <Metric label="Procesadas" value={formatNumber(crawl?.crawledUrls ?? 0)} />
        <Metric label="Pendientes" value={formatNumber(metrics?.pending ?? 0)} />
        <Metric label="Errores" value={formatNumber(crawl?.failedUrls ?? 0)} />
        <Metric
          label="Velocidad"
          value={`${formatNumber(metrics?.urlsPerMinute ?? 0)} URL/min`}
        />
      </div>

      <div className="text-xs text-muted">
        Tiempo transcurrido: {formatDuration(metrics?.elapsedSeconds ?? 0)}
      </div>

      {data?.events && data.events.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Log del crawl</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono">
            {data.events.map((e) => (
              <li
                key={e.id}
                className={e.level === 'warn' ? 'text-warn' : e.level === 'error' ? 'text-bad' : 'text-muted'}
              >
                [{e.event}] {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
