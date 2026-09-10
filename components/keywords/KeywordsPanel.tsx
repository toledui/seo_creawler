'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, formatNumber, truncate } from '@/lib/format';
import { StatCard } from '@/components/ui';
import { SerpDetail } from './SerpDetail';

type Keyword = {
  id: string;
  keyword: string;
  country: string;
  device: string;
  source: string;
  tags: string | null;
  targetUrl: string | null;
  tracked: boolean;
  lastPosition: number | null;
  bestPosition: number | null;
  previousPosition: number | null;
  lastClicks: number | null;
  lastImpressions: number | null;
  lastCtr: number | null;
  lastUrl: string | null;
  lastCheckedAt: string | null;
  serpPosition: number | null;
  serpPreviousPosition: number | null;
  serpBestPosition: number | null;
  serpCheckedAt: string | null;
};

type Summary = {
  total: number;
  tracked: number;
  buckets: { top3: number; top10: number; top30: number; rest: number; none: number };
  averagePosition: number | null;
  totalClicks: number;
  totalImpressions: number;
  improved: number;
  worsened: number;
};

type Ranking = {
  date: string;
  position: number | null;
  clicks: number;
  impressions: number;
  ctr: number;
};

export function KeywordsPanel({
  projectId,
  projectDomain = '',
}: {
  projectId: string;
  projectDomain?: string;
}) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: 50,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    search: '',
    bucket: '',
    tracked: '',
    source: '',
    sort: 'lastImpressions',
    dir: 'desc',
    page: 1,
  });

  const [selected, setSelected] = useState<Keyword | null>(null);
  const [history, setHistory] = useState<Ranking[] | null>(null);
  const [serpFor, setSerpFor] = useState<Keyword | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newKeywords, setNewKeywords] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.bucket) params.set('bucket', filters.bucket);
    if (filters.tracked) params.set('tracked', filters.tracked);
    if (filters.source) params.set('source', filters.source);
    params.set('sort', filters.sort);
    params.set('dir', filters.dir);
    params.set('page', String(filters.page));

    try {
      const res = await fetch(`/api/projects/${projectId}/keywords?${params}`, {
        cache: 'no-store',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudieron cargar las keywords');
      setKeywords(body.keywords ?? []);
      setSummary(body.summary ?? null);
      setPagination(body.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, filters]);

  useEffect(() => {
    load();
  }, [load]);

  async function addKeywords() {
    const list = newKeywords
      .split(/\r?\n|,/)
      .map((k) => k.trim())
      .filter(Boolean);

    if (list.length === 0) return;

    const res = await fetch(`/api/projects/${projectId}/keywords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keywords: list }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'No se pudieron añadir');
      return;
    }

    setNotice(`${body.created} añadidas, ${body.skipped} descartadas o duplicadas`);
    setNewKeywords('');
    setShowAdd(false);
    load();
  }

  async function importCsv(file: File) {
    setLoading(true);
    setError(null);
    setNotice(null);

    const form = new FormData();
    form.append('file', file);

    const res = await fetch(`/api/projects/${projectId}/keywords/import`, {
      method: 'POST',
      body: form,
    });

    const body = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? 'La importación falló');
      return;
    }

    const r = body.result;
    setNotice(
      `Importadas ${r.total} filas: ${r.created} nuevas, ${r.updated} actualizadas, ${r.skipped} descartadas`,
    );
    load();
  }

  async function toggleTracked(keyword: Keyword) {
    await fetch(`/api/projects/${projectId}/keywords/${keyword.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tracked: !keyword.tracked }),
    });
    load();
  }

  async function remove(keyword: Keyword) {
    await fetch(`/api/projects/${projectId}/keywords/${keyword.id}`, {
      method: 'DELETE',
    });
    if (selected?.id === keyword.id) setSelected(null);
    load();
  }

  async function openHistory(keyword: Keyword) {
    setSelected(keyword);
    setHistory(null);
    const res = await fetch(
      `/api/projects/${projectId}/keywords/${keyword.id}?days=90`,
      { cache: 'no-store' },
    );
    const body = await res.json().catch(() => ({}));
    if (res.ok) setHistory(body.keyword?.rankings ?? []);
  }

  const setFilter = (patch: Partial<typeof filters>) =>
    setFilters((f) => ({ ...f, page: 1, ...patch }));

  function sortBy(column: string) {
    setFilters((f) => ({
      ...f,
      page: 1,
      sort: column,
      dir: f.sort === column && f.dir === 'desc' ? 'asc' : 'desc',
    }));
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Keywords"
            value={formatNumber(summary.total)}
            hint={`${formatNumber(summary.tracked)} en seguimiento`}
          />
          <StatCard
            label="Posición media"
            value={summary.averagePosition?.toFixed(1) ?? '—'}
            tone={
              summary.averagePosition == null
                ? 'default'
                : summary.averagePosition <= 10
                  ? 'ok'
                  : summary.averagePosition <= 30
                    ? 'warn'
                    : 'bad'
            }
          />
          <StatCard
            label="Top 10"
            value={formatNumber(summary.buckets.top3 + summary.buckets.top10)}
            tone="ok"
            hint={`${formatNumber(summary.buckets.top3)} en top 3`}
          />
          <StatCard
            label="Movimiento"
            value={`↑${summary.improved} ↓${summary.worsened}`}
            tone={summary.improved >= summary.worsened ? 'ok' : 'bad'}
            hint="frente a la medición anterior"
          />
        </div>
      )}

      {summary && summary.total > 0 && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold">Reparto por posición</h3>
          <div className="flex h-3 overflow-hidden rounded bg-panel2">
            {(
              [
                ['top3', summary.buckets.top3, 'bg-ok', '1-3'],
                ['top10', summary.buckets.top10, 'bg-accent', '4-10'],
                ['top30', summary.buckets.top30, 'bg-warn', '11-30'],
                ['rest', summary.buckets.rest, 'bg-bad', '31+'],
                ['none', summary.buckets.none, 'bg-line', 'sin datos'],
              ] as const
            ).map(([key, count, color]) => (
              <div
                key={key}
                className={color}
                style={{ width: `${(count / summary.total) * 100}%` }}
                title={`${count} keywords`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
            {(
              [
                ['top3', summary.buckets.top3, 'bg-ok', '1-3'],
                ['top10', summary.buckets.top10, 'bg-accent', '4-10'],
                ['top30', summary.buckets.top30, 'bg-warn', '11-30'],
                ['rest', summary.buckets.rest, 'bg-bad', '31+'],
                ['none', summary.buckets.none, 'bg-line', 'sin datos'],
              ] as const
            ).map(([key, count, color, label]) => (
              <button
                key={key}
                className="flex items-center gap-1 hover:text-fg"
                onClick={() =>
                  setFilter({ bucket: filters.bucket === key ? '' : key })
                }
              >
                <span className={`inline-block h-2 w-2 rounded-sm ${color}`} />
                {label}: {formatNumber(count)}
              </button>
            ))}
          </div>
        </div>
      )}

      {notice && (
        <p className="rounded border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="card flex flex-wrap items-end gap-3">
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <label className="label">Buscar</label>
          <input
            className="input"
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            placeholder="zapatillas"
          />
        </form>

        <div>
          <label className="label">Seguimiento</label>
          <select
            className="input w-auto"
            value={filters.tracked}
            onChange={(e) => setFilter({ tracked: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="true">En seguimiento</option>
            <option value="false">Pausadas</option>
          </select>
        </div>

        <div>
          <label className="label">Origen</label>
          <select
            className="input w-auto"
            value={filters.source}
            onChange={(e) => setFilter({ source: e.target.value })}
          >
            <option value="">Todos</option>
            <option value="GSC">Search Console</option>
            <option value="CSV">CSV</option>
            <option value="MANUAL">Manual</option>
          </select>
        </div>

        <button className="btn" onClick={() => setShowAdd((v) => !v)}>
          + Añadir
        </button>

        <button className="btn" onClick={() => fileRef.current?.click()}>
          Importar CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importCsv(file);
            e.target.value = '';
          }}
        />
      </div>

      {showAdd && (
        <div className="card space-y-2">
          <label className="label">Keywords (una por línea)</label>
          <textarea
            className="input h-28"
            value={newKeywords}
            onChange={(e) => setNewKeywords(e.target.value)}
            placeholder={'zapatillas running\ncamiseta técnica'}
          />
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={addKeywords}>
              Añadir
            </button>
            <button className="btn" onClick={() => setShowAdd(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="card max-h-[60vh] overflow-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>
                <button onClick={() => sortBy('keyword')}>Keyword</button>
              </th>
              <th className="text-right" title="Posición media que reporta Search Console">
                <button onClick={() => sortBy('lastPosition')}>Pos. GSC</button>
              </th>
              <th className="text-right" title="Puesto exacto medido hoy en el SERP">
                <button onClick={() => sortBy('serpPosition')}>Pos. real</button>
              </th>
              <th className="text-right">Cambio</th>
              <th className="text-right">
                <button onClick={() => sortBy('bestPosition')}>Mejor</button>
              </th>
              <th className="text-right">
                <button onClick={() => sortBy('lastClicks')}>Clics</button>
              </th>
              <th className="text-right">
                <button onClick={() => sortBy('lastImpressions')}>Impres.</button>
              </th>
              <th className="text-right">CTR</th>
              <th>URL</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted">
                  Cargando…
                </td>
              </tr>
            )}

            {!loading && keywords.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted">
                  No hay keywords. Impórtalas desde un CSV, añádelas a mano o
                  conecta Search Console para descubrir las que ya rankean.
                </td>
              </tr>
            )}

            {!loading &&
              keywords.map((keyword) => {
                const delta =
                  keyword.lastPosition != null && keyword.previousPosition != null
                    ? keyword.previousPosition - keyword.lastPosition
                    : null;

                return (
                  <tr key={keyword.id} className={keyword.tracked ? '' : 'opacity-50'}>
                    <td>
                      <button
                        className="link text-left"
                        onClick={() => openHistory(keyword)}
                      >
                        {truncate(keyword.keyword, 45)}
                      </button>
                      <div className="text-[11px] text-muted">
                        {keyword.country.toUpperCase()} · {keyword.device} ·{' '}
                        {keyword.source}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">
                      {keyword.lastPosition != null
                        ? keyword.lastPosition.toFixed(1)
                        : '—'}
                    </td>
                    <td className="text-right tabular-nums">
                      {keyword.serpPosition != null ? (
                        <button
                          className="link"
                          onClick={() => setSerpFor(keyword)}
                          title="Ver el SERP y los competidores"
                        >
                          #{keyword.serpPosition}
                        </button>
                      ) : keyword.serpCheckedAt ? (
                        <button
                          className="link text-muted"
                          onClick={() => setSerpFor(keyword)}
                          title="Medida, pero fuera del top"
                        >
                          fuera
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {delta == null || delta === 0 ? (
                        <span className="text-muted">—</span>
                      ) : delta > 0 ? (
                        <span className="text-ok">↑{delta.toFixed(1)}</span>
                      ) : (
                        <span className="text-bad">↓{Math.abs(delta).toFixed(1)}</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-muted">
                      {keyword.bestPosition != null
                        ? keyword.bestPosition.toFixed(1)
                        : '—'}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatNumber(keyword.lastClicks ?? 0)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatNumber(keyword.lastImpressions ?? 0)}
                    </td>
                    <td className="text-right tabular-nums text-muted">
                      {keyword.lastCtr != null
                        ? `${(keyword.lastCtr * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="font-mono text-[11px] text-muted">
                      {keyword.lastUrl || keyword.targetUrl
                        ? truncate(
                            new URL(
                              (keyword.lastUrl ?? keyword.targetUrl)!,
                              'http://x',
                            ).pathname,
                            30,
                          )
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        className="link text-xs"
                        onClick={() => toggleTracked(keyword)}
                        title={
                          keyword.tracked
                            ? 'Dejar de medir a diario'
                            : 'Volver a medir a diario'
                        }
                      >
                        {keyword.tracked ? 'Pausar' : 'Activar'}
                      </button>
                      <button
                        className="ml-2 text-xs text-bad hover:underline"
                        onClick={() => remove(keyword)}
                      >
                        Borrar
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          {formatNumber(pagination.total)} keywords · página {pagination.page} de{' '}
          {Math.max(1, pagination.totalPages)}
        </span>
        <div className="flex gap-2">
          <button
            className="btn"
            disabled={pagination.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            ← Anterior
          </button>
          <button
            className="btn"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            Siguiente →
          </button>
        </div>
      </div>

      {selected && (
        <HistoryPanel
          keyword={selected}
          history={history}
          onClose={() => setSelected(null)}
        />
      )}

      {serpFor && (
        <SerpDetail
          projectId={projectId}
          keywordId={serpFor.id}
          ownDomain={projectDomain}
          onClose={() => setSerpFor(null)}
        />
      )}
    </div>
  );
}

/** Evolución de una keyword: sparkline de posición y tabla de días. */
function HistoryPanel({
  keyword,
  history,
  onClose,
}: {
  keyword: Keyword;
  history: Ranking[] | null;
  onClose: () => void;
}) {
  const chart = useMemo(() => {
    if (!history) return null;
    const points = history.filter((r) => r.position != null);
    if (points.length < 2) return null;

    const width = 640;
    const height = 140;
    const pad = 10;

    const positions = points.map((p) => p.position!);
    const maxPos = Math.max(...positions, 10);
    const minPos = Math.min(...positions, 1);
    const range = Math.max(1, maxPos - minPos);

    // El eje Y va invertido: la posición 1 es la mejor y va arriba.
    const coords = points.map((point, i) => {
      const x = pad + (i / (points.length - 1)) * (width - pad * 2);
      const y = pad + ((point.position! - minPos) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return { path: `M${coords.join(' L')}`, width, height, minPos, maxPos };
  }, [history]);

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{keyword.keyword}</p>
          <p className="text-xs text-muted">
            {keyword.country.toUpperCase()} · {keyword.device} · origen{' '}
            {keyword.source} · última medición{' '}
            {formatDate(keyword.lastCheckedAt)}
          </p>
        </div>
        <button className="text-muted hover:text-fg" onClick={onClose}>
          ✕
        </button>
      </div>

      {history == null && <p className="text-sm text-muted">Cargando histórico…</p>}

      {history && history.length === 0 && (
        <p className="text-sm text-muted">
          Todavía no hay mediciones. El tracking diario las irá rellenando.
        </p>
      )}

      {chart && (
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            className="h-36 w-full min-w-[420px]"
          >
            <path d={chart.path} fill="none" stroke="#4f9dff" strokeWidth={2} />
          </svg>
          <p className="text-[11px] text-muted">
            Posición {chart.minPos.toFixed(1)} (arriba) a {chart.maxPos.toFixed(1)}{' '}
            (abajo) · {history?.filter((r) => r.position != null).length} días con
            datos
          </p>
        </div>
      )}

      {history && history.length > 0 && (
        <div className="max-h-56 overflow-y-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="text-right">Posición</th>
                <th className="text-right">Clics</th>
                <th className="text-right">Impresiones</th>
                <th className="text-right">CTR</th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((row) => (
                <tr key={row.date}>
                  <td className="whitespace-nowrap text-muted">
                    {new Date(row.date).toLocaleDateString('es-ES')}
                  </td>
                  <td className="text-right tabular-nums">
                    {row.position != null ? row.position.toFixed(1) : 'sin datos'}
                  </td>
                  <td className="text-right tabular-nums">{formatNumber(row.clicks)}</td>
                  <td className="text-right tabular-nums">
                    {formatNumber(row.impressions)}
                  </td>
                  <td className="text-right tabular-nums text-muted">
                    {(row.ctr * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
