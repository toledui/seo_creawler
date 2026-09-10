'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { DownloadReport } from './DownloadReport';
import { EmailReport } from '@/components/EmailReport';
import type { AuditReport } from '@/src/ai/prompts/executive-report';

type ReportRow = {
  id: string;
  model: string;
  createdAt: string;
  output: AuditReport | null;
  error: string | null;
};

export function AiAudit({
  projectId,
  crawlId,
  enabled,
  initialReports,
}: {
  projectId: string;
  crawlId: string;
  enabled: boolean;
  initialReports: ReportRow[];
}) {
  const [reports, setReports] = useState(initialReports);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialReports.find((r) => r.output)?.id ?? null,
  );

  async function generate() {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/crawls/${crawlId}/ai/report`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? 'No se pudo generar el informe');
      setLoading(false);
      return;
    }

    setReports((current) => [body.report, ...current]);
    setSelectedId(body.report.id);
    setLoading(false);
  }

  const usable = reports.filter((r) => r.output);

  // Se muestra el informe elegido; por defecto, el último con contenido.
  const latest =
    usable.find((r) => r.id === selectedId) ?? usable[0] ?? undefined;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Auditoría SEO + GEO con IA</p>
          <p className="text-sm text-muted">
            Se envía a DeepSeek un resumen estructurado del crawl (métricas,
            issues, PageRank y señales GEO), nunca el HTML de las páginas.
            Cada informe queda guardado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {usable.length > 1 && (
            <select
              className="input w-auto py-1 text-xs"
              value={latest?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {usable.map((report) => (
                <option key={report.id} value={report.id}>
                  {formatDate(report.createdAt)} · score {report.output?.score ?? '—'}
                </option>
              ))}
            </select>
          )}

          <button
            className="btn btn-primary"
            onClick={generate}
            disabled={loading || !enabled}
          >
            {loading ? 'Analizando…' : 'Generate AI Audit'}
          </button>
        </div>
      </div>

      {!enabled && (
        <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          DeepSeek no está configurado. Añade <code>DEEPSEEK_API_KEY</code> en{' '}
          <code>.env</code> y reinicia el servidor.
        </p>
      )}

      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {loading && (
        <div className="card text-sm text-muted">
          Generando informe… puede tardar entre 30 y 90 segundos.
        </div>
      )}

      {latest?.output && (
        <ReportView
          report={latest.output}
          meta={latest}
          projectId={projectId}
        />
      )}

      {reports.length > 1 && (
        <details className="card">
          <summary className="cursor-pointer text-sm text-muted">
            Historial de informes de este crawl ({reports.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {reports.map((report) => (
              <li key={report.id} className="flex items-center justify-between gap-2">
                <span className="text-muted">{formatDate(report.createdAt)}</span>
                <span>{report.model}</span>
                {report.error ? (
                  <span className="text-bad" title={report.error}>
                    error
                  </span>
                ) : (
                  <button
                    className={`link ${report.id === latest?.id ? 'font-medium' : ''}`}
                    onClick={() => setSelectedId(report.id)}
                  >
                    score {report.output?.score ?? '—'}
                    {report.id === latest?.id ? ' · viendo' : ' · abrir'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReportView({
  report,
  meta,
  projectId,
}: {
  report: AuditReport;
  meta: { id: string; model: string; createdAt: string };
  projectId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold">Resumen ejecutivo</h3>
          <div className="text-right">
            <div className="text-3xl font-semibold text-accent">{report.score}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted">
              score IA
            </div>
          </div>
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed">{report.summary}</p>
        {report.seoHealth && (
          <p className="mt-3 text-sm text-muted">{report.seoHealth}</p>
        )}
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

      {report.criticalIssues.length > 0 && (
        <div className="card border-bad/40">
          <h3 className="mb-2 text-sm font-semibold text-bad">Problemas críticos</h3>
          <ul className="space-y-3">
            {report.criticalIssues.map((issue, i) => (
              <li key={i} className="border-l-2 border-bad/50 pl-3">
                <p className="text-sm font-medium">{issue.title}</p>
                <p className="text-sm text-muted">{issue.impact}</p>
                {issue.evidence && (
                  <p className="mt-1 text-xs text-muted">Evidencia: {issue.evidence}</p>
                )}
                {issue.affectedUrls?.length > 0 && (
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-accent">
                    {issue.affectedUrls.slice(0, 5).map((url) => (
                      <li key={url} className="truncate">
                        {url}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.highPriorityIssues.length > 0 && (
        <div className="card border-warn/40">
          <h3 className="mb-2 text-sm font-semibold text-warn">Prioridad alta</h3>
          <ul className="space-y-2">
            {report.highPriorityIssues.map((issue, i) => (
              <li key={i} className="border-l-2 border-warn/50 pl-3">
                <p className="text-sm font-medium">{issue.title}</p>
                <p className="text-sm text-muted">{issue.impact}</p>
                {issue.evidence && (
                  <p className="text-xs text-muted">{issue.evidence}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {report.internalLinking && (
          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">Enlazado interno</h3>
            <p className="text-sm">{report.internalLinking.diagnosis}</p>
            {report.internalLinking.wastedPageRank && (
              <p className="mt-2 text-sm text-muted">
                {report.internalLinking.wastedPageRank}
              </p>
            )}
            {report.internalLinking.pagesToBoost?.length > 0 && (
              <>
                <p className="mt-3 text-xs uppercase tracking-wide text-muted">
                  Páginas a reforzar
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-accent">
                  {report.internalLinking.pagesToBoost.slice(0, 10).map((url) => (
                    <li key={url} className="truncate">
                      {url}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <BulletList items={report.internalLinking.recommendations ?? []} />
          </div>
        )}

        {report.geo && (
          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">GEO Readiness</h3>
            <p className="text-sm">{report.geo.readiness}</p>
            <BulletList title="Carencias" items={report.geo.gaps ?? []} />
            <BulletList
              title="Recomendaciones"
              items={report.geo.recommendations ?? []}
            />
          </div>
        )}

        {report.technicalSeo && (
          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">SEO técnico</h3>
            <BulletList items={report.technicalSeo.findings} />
          </div>
        )}

        {report.contentFindings && (
          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">Contenido</h3>
            <BulletList items={report.contentFindings.findings} />
          </div>
        )}
      </div>

      {report.recommendations.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="mb-2 text-sm font-semibold">Acciones recomendadas</h3>
          <table className="table">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Acción</th>
                <th>Justificación</th>
                <th>Impacto esperado</th>
                <th>Esfuerzo</th>
              </tr>
            </thead>
            <tbody>
              {[...report.recommendations]
                .sort((a, b) => a.priority - b.priority)
                .map((rec, i) => (
                  <tr key={i}>
                    <td className="tabular-nums text-muted">{rec.priority}</td>
                    <td className="font-medium">{rec.action}</td>
                    <td className="text-xs text-muted">{rec.rationale}</td>
                    <td className="text-xs text-muted">{rec.expectedImpact}</td>
                    <td>
                      <span
                        className={`badge ${
                          rec.effort === 'LOW'
                            ? 'bg-ok/15 text-ok'
                            : rec.effort === 'HIGH'
                              ? 'bg-bad/15 text-bad'
                              : 'bg-warn/15 text-warn'
                        }`}
                      >
                        {rec.effort}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {report.implementationOrder.length > 0 && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold">Orden de implementación</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {report.implementationOrder.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function BulletList({ title, items }: { title?: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <>
      {title && (
        <p className="mt-3 text-xs uppercase tracking-wide text-muted">{title}</p>
      )}
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </>
  );
}
