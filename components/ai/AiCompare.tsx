'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDate, formatNumber } from '@/lib/format';
import { DownloadReport } from './DownloadReport';
import { EmailReport } from '@/components/EmailReport';
import type { ComparisonReport } from '@/src/ai/prompts/compare-reports';

type ReportOption = {
  id: string;
  model: string;
  type: string;
  createdAt: string;
  crawlId: string;
  crawledUrls: number;
  score: number | null;
};

type SavedComparison = {
  id: string;
  model: string;
  createdAt: string;
  input: {
    baseReportId?: string;
    targetReportId?: string;
    baseCreatedAt?: string;
    targetCreatedAt?: string;
    sameCrawl?: boolean;
  } | null;
  output: ComparisonReport | null;
};

/**
 * Compara dos auditorías guardadas usando el mismo modelo que las generó.
 *
 * El LLM no recibe el crawl entero: se le pasan los dos informes ya
 * estructurados más el diff determinístico de los rastreos, de modo que
 * el "antes → después" sale de cifras reales.
 */
export function AiCompare({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [comparisons, setComparisons] = useState<SavedComparison[]>([]);
  const [baseId, setBaseId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [current, setCurrent] = useState<SavedComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [reportsRes, comparisonsRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/ai/reports?type=audit`, {
        cache: 'no-store',
      }),
      fetch(`/api/projects/${projectId}/ai/compare`, { cache: 'no-store' }),
    ]);

    if (reportsRes.ok) {
      const body = await reportsRes.json();
      const list: ReportOption[] = body.reports ?? [];
      setReports(list);
      // Por defecto: el más reciente frente al anterior.
      if (list.length >= 2) {
        setTargetId((v) => v || list[0].id);
        setBaseId((v) => v || list[1].id);
      }
    }

    if (comparisonsRes.ok) {
      const body = await comparisonsRes.json();
      const list: SavedComparison[] = body.comparisons ?? [];
      setComparisons(list);
      setCurrent((v) => v ?? list[0] ?? null);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/projects/${projectId}/ai/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseReportId: baseId, targetReportId: targetId }),
    });

    const body = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? 'No se pudo comparar');
      return;
    }

    setCurrent(body.comparison);
    setComparisons((list) => [body.comparison, ...list]);
  }

  const label = (report: ReportOption) =>
    `${formatDate(report.createdAt)} · score ${report.score ?? '—'} · ${formatNumber(report.crawledUrls)} URLs`;

  if (reports.length < 2) {
    return (
      <div className="card">
        <p className="font-medium">Comparar auditorías</p>
        <p className="mt-1 text-sm text-muted">
          Hacen falta al menos dos informes guardados de este proyecto.
          {reports.length === 1
            ? ' Ya hay uno: genera otro más adelante (o tras aplicar cambios) para poder comparar.'
            : ' Genera el primero con “Generate AI Audit”.'}
        </p>
      </div>
    );
  }

  const sameCrawl = current?.input?.sameCrawl;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <p className="font-medium">Comparar auditorías</p>
          <p className="text-sm text-muted">
            La IA enfrenta dos informes guardados y el diff real de los
            rastreos: qué se arregló, qué sigue igual y qué empeoró.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Informe anterior</label>
            <select
              className="input w-auto"
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
            >
              {reports.map((report) => (
                <option
                  key={report.id}
                  value={report.id}
                  disabled={report.id === targetId}
                >
                  {label(report)}
                </option>
              ))}
            </select>
          </div>

          <div className="pb-2 text-muted">→</div>

          <div>
            <label className="label">Informe nuevo</label>
            <select
              className="input w-auto"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {reports.map((report) => (
                <option
                  key={report.id}
                  value={report.id}
                  disabled={report.id === baseId}
                >
                  {label(report)}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn btn-primary"
            onClick={generate}
            disabled={loading || !enabled || !baseId || !targetId || baseId === targetId}
          >
            {loading ? 'Comparando…' : 'Comparar con IA'}
          </button>

          {comparisons.length > 0 && (
            <select
              className="input ml-auto w-auto py-1 text-xs"
              value={current?.id ?? ''}
              onChange={(e) =>
                setCurrent(comparisons.find((c) => c.id === e.target.value) ?? null)
              }
            >
              {comparisons.map((comparison) => (
                <option key={comparison.id} value={comparison.id}>
                  {formatDate(comparison.createdAt)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {loading && (
        <div className="card text-sm text-muted">
          Comparando informes… puede tardar entre 20 y 60 segundos.
        </div>
      )}

      {sameCrawl && (
        <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Los dos informes salen del mismo rastreo, así que los datos técnicos
          son idénticos: la comparación sólo contrasta el criterio de cada
          informe, no la evolución del sitio.
        </p>
      )}

      {current?.output && (
        <ComparisonView
          comparison={current.output}
          meta={current}
          projectId={projectId}
        />
      )}
    </div>
  );
}

function ComparisonView({
  comparison,
  meta,
  projectId,
}: {
  comparison: ComparisonReport;
  meta: { id: string; model: string; createdAt: string };
  projectId: string;
}) {
  const verdictTone =
    comparison.verdict === 'MEJORA'
      ? 'text-ok'
      : comparison.verdict === 'EMPEORA'
        ? 'text-bad'
        : 'text-warn';

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold">Evolución</h3>
          <div className="text-right">
            <div className={`text-2xl font-semibold ${verdictTone}`}>
              {comparison.verdict}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted">
              score{' '}
              {comparison.scoreDelta > 0 ? '+' : ''}
              {comparison.scoreDelta}
            </div>
          </div>
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed">
          {comparison.summary}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-[11px] text-muted">
            {meta.model} · {formatDate(meta.createdAt)}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <DownloadReport projectId={projectId} reportId={meta.id} />
            <EmailReport
              endpoint={`/api/projects/${projectId}/ai/reports/${meta.id}/email`}
              compact
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Block
          title="Resuelto"
          tone="border-ok/40"
          titleTone="text-ok"
          empty="Nada se ha resuelto entre ambos informes."
          items={comparison.resolved.map((item) => ({
            title: item.title,
            lines: [item.evidence],
          }))}
        />

        <Block
          title="Sigue igual"
          tone="border-warn/40"
          titleTone="text-warn"
          empty="Sin problemas heredados."
          items={comparison.persisting.map((item) => ({
            title: item.title,
            lines: [item.evidence, item.whyItMatters],
          }))}
        />

        <Block
          title="Ha empeorado"
          tone="border-bad/40"
          titleTone="text-bad"
          empty="No hay regresiones."
          items={comparison.regressions.map((item) => ({
            title: item.title,
            lines: [item.evidence, item.impact],
          }))}
        />
      </div>

      {comparison.recommendationsStatus.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="mb-2 text-sm font-semibold">
            Estado de las recomendaciones anteriores
          </h3>
          <table className="table">
            <thead>
              <tr>
                <th>Acción recomendada</th>
                <th>Estado</th>
                <th>Evidencia</th>
              </tr>
            </thead>
            <tbody>
              {comparison.recommendationsStatus.map((row, i) => (
                <tr key={i}>
                  <td className="font-medium">{row.action}</td>
                  <td>
                    <span
                      className={`badge ${
                        row.status === 'APLICADA'
                          ? 'bg-ok/15 text-ok'
                          : row.status === 'PARCIAL'
                            ? 'bg-warn/15 text-warn'
                            : row.status === 'PENDIENTE'
                              ? 'bg-bad/15 text-bad'
                              : 'bg-panel2 text-muted'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="text-xs text-muted">{row.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {comparison.nextActions.length > 0 && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold">Siguientes pasos</h3>
          <ol className="space-y-2">
            {[...comparison.nextActions]
              .sort((a, b) => a.priority - b.priority)
              .map((action, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="tabular-nums text-muted">{action.priority}.</span>
                  <div>
                    <p className="font-medium">{action.action}</p>
                    {action.rationale && (
                      <p className="text-xs text-muted">{action.rationale}</p>
                    )}
                  </div>
                </li>
              ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Block({
  title,
  tone,
  titleTone,
  items,
  empty,
}: {
  title: string;
  tone: string;
  titleTone: string;
  items: { title: string; lines: (string | undefined)[] }[];
  empty: string;
}) {
  return (
    <div className={`card ${tone}`}>
      <h3 className={`mb-2 text-sm font-semibold ${titleTone}`}>
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="border-l-2 border-line pl-3">
              <p className="text-sm font-medium">{item.title}</p>
              {item.lines
                .filter((line): line is string => Boolean(line))
                .map((line, j) => (
                  <p key={j} className="text-xs text-muted">
                    {line}
                  </p>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
