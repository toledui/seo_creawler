'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatNumber } from '@/lib/format';

type SiloPage = {
  pageId: string;
  url: string;
  path: string;
  title: string | null;
  status: number | null;
  depth: number;
  inlinks: number;
  outlinks: number;
  pagerank: number;
  indexable: boolean;
  isHub: boolean;
};

type Silo = {
  key: string;
  label: string;
  pages: number;
  indexablePages: number;
  orphans: number;
  avgDepth: number;
  pagerank: number;
  pagerankShare: number;
  internalLinks: number;
  outboundLinks: number;
  inboundLinks: number;
  cohesion: number;
  hub: SiloPage | null;
  topPages: SiloPage[];
};

type Report = {
  depth: 1 | 2;
  grouping: 'path' | 'slug';
  flatSite: boolean;
  totalPages: number;
  analyzedPages: number;
  totalInternalLinks: number;
  crossSiloLinks: number;
  cohesion: number;
  silos: Silo[];
  flows: { from: string; to: string; links: number }[];
  findings: {
    code: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    silo: string | null;
    title: string;
    detail: string;
  }[];
  truncated: boolean;
};

const SEVERITY_STYLE = {
  HIGH: 'border-bad/40 bg-bad/10 text-bad',
  MEDIUM: 'border-warn/40 bg-warn/10 text-warn',
  LOW: 'border-line bg-panel2 text-muted',
} as const;

/** Verde si la sección se sostiene sola, rojo si reparte fuerza a todas partes. */
function cohesionColor(value: number): string {
  if (value >= 0.6) return 'bg-ok';
  if (value >= 0.3) return 'bg-warn';
  return 'bg-bad';
}

const pct = (value: number) => `${Math.round(value * 100)} %`;

/**
 * Mapa de silos.
 *
 * Responde a una pregunta concreta: ¿el enlazado interno respeta la
 * arquitectura del sitio? La matriz es la respuesta rápida — una diagonal
 * marcada significa que cada sección se enlaza a sí misma; una matriz
 * repartida significa que el menú enlaza a todo desde todas partes y
 * ninguna sección acumula autoridad temática.
 */
export function SiloMap({ crawlId }: { crawlId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [grouping, setGrouping] = useState<'path' | 'slug'>('path');
  const [depth, setDepth] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [allFindings, setAllFindings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const res = await fetch(
      `/api/crawls/${crawlId}/silos?grouping=${grouping}&depth=${depth}`,
      { cache: 'no-store' },
    );

    setLoading(false);

    if (!res.ok) {
      setError('No se pudo calcular el mapa de silos');
      return;
    }

    setReport(await res.json());
    setSelected(null);
    setAllFindings(false);
  }, [crawlId, grouping, depth]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !report) {
    return <p className="text-sm text-muted">Calculando el mapa de silos…</p>;
  }
  if (error) {
    return (
      <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
        {error}
      </p>
    );
  }
  if (!report) return null;

  const detail = report.silos.find((silo) => silo.key === selected) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-medium">Agrupar las páginas por</p>
          <p className="text-sm text-muted">
            Un silo es la sección que tú definiste, no un cluster que el
            algoritmo descubre. Aquí se comprueba si el enlazado la respeta.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Criterio</label>
            <select
              className="input w-auto"
              value={grouping}
              disabled={loading}
              onChange={(e) => setGrouping(e.target.value as 'path' | 'slug')}
            >
              <option value="path">Carpeta de la URL</option>
              <option value="slug">Tema del slug</option>
            </select>
          </div>

          {grouping === 'path' && (
            <div>
              <label className="label">Profundidad</label>
              <select
                className="input w-auto"
                value={depth}
                disabled={loading}
                onChange={(e) => setDepth(Number(e.target.value) as 1 | 2)}
              >
                <option value={1}>/servicios</option>
                <option value={2}>/servicios/seo</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {report.flatSite && grouping === 'path' && (
        <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          <p className="font-medium text-warn">Este sitio es plano</p>
          <p className="mt-1 text-fg/80">
            Casi todas las URLs cuelgan de la raíz, así que por carpeta no hay
            nada que separar.{' '}
            <button className="link" onClick={() => setGrouping('slug')}>
              Agrupar por tema del slug
            </button>{' '}
            para ver los grupos temáticos que sí existen.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Páginas HTML" value={formatNumber(report.analyzedPages)} />
        <Tile
          label={grouping === 'path' ? 'Secciones' : 'Temas'}
          value={formatNumber(report.silos.length)}
        />
        <Tile
          label="Enlaces que se quedan dentro"
          value={pct(report.cohesion)}
          tone={report.cohesion >= 0.6 ? 'ok' : report.cohesion >= 0.3 ? 'warn' : 'bad'}
        />
        <Tile
          label="Enlaces que cruzan de sección"
          value={formatNumber(report.crossSiloLinks)}
        />
      </div>

      {report.findings.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">
            Diagnóstico{' '}
            <span className="text-sm font-normal text-muted">
              ({report.findings.length})
            </span>
          </h2>
          {/* Sin recortar, treinta hallazgos entierran el mapa. */}
          {(allFindings ? report.findings : report.findings.slice(0, 5)).map(
            (finding, index) => (
              <div
                key={`${finding.code}-${finding.silo}-${index}`}
                className={`rounded border px-3 py-2 ${SEVERITY_STYLE[finding.severity]}`}
              >
                <p className="text-sm font-medium">{finding.title}</p>
                <p className="mt-1 text-xs text-fg/70">{finding.detail}</p>
              </div>
            ),
          )}

          {report.findings.length > 5 && (
            <button className="link text-sm" onClick={() => setAllFindings((v) => !v)}>
              {allFindings
                ? 'Ver sólo los 5 primeros'
                : `Ver los ${report.findings.length - 5} restantes`}
            </button>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Secciones</h2>
        <p className="text-sm text-muted">
          La barra mide qué parte del enlazado de cada sección se queda dentro
          de ella. Pulsa una fila para ver sus páginas.
        </p>

        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Sección</th>
                <th className="px-3 py-2 text-right">Páginas</th>
                <th className="px-3 py-2">Cabecera</th>
                <th className="px-3 py-2 text-right">Entran</th>
                <th className="px-3 py-2 text-right">Salen</th>
                <th className="px-3 py-2">Se queda dentro</th>
                <th className="px-3 py-2 text-right">Fuerza</th>
              </tr>
            </thead>
            <tbody>
              {report.silos.map((silo) => (
                <tr
                  key={silo.key}
                  onClick={() => setSelected(silo.key === selected ? null : silo.key)}
                  className={`cursor-pointer border-t border-line transition hover:bg-panel2 ${
                    silo.key === selected ? 'bg-panel2' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{silo.label}</span>
                    {silo.orphans > 0 && (
                      <span className="badge ml-2 bg-bad/15 text-bad">
                        {silo.orphans} huérfanas
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(silo.pages)}</td>
                  <td className="px-3 py-2">
                    {silo.hub ? (
                      <span className="text-xs">
                        <span className="text-fg/80">{silo.hub.path}</span>
                        <span className="text-muted"> · {silo.hub.inlinks} enl.</span>
                      </span>
                    ) : silo.pages >= 3 ? (
                      <span className="text-xs text-bad">no existe</span>
                    ) : (
                      // Con una o dos páginas, que no haya portada de sección
                      // no es un problema: no hay sección que encabezar.
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatNumber(silo.inboundLinks)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatNumber(silo.outboundLinks)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded bg-panel2">
                        <div
                          className={`h-full ${cohesionColor(silo.cohesion)}`}
                          style={{ width: `${Math.round(silo.cohesion * 100)}%` }}
                        />
                      </div>
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted">
                        {pct(silo.cohesion)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted">
                    {pct(silo.pagerankShare)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {detail && <SiloDetail silo={detail} />}

      <FlowMatrix report={report} onSelect={setSelected} />
    </div>
  );
}

/** Páginas de una sección, ordenadas por enlaces entrantes. */
function SiloDetail({ silo }: { silo: Silo }) {
  return (
    <section className="card space-y-3">
      <div>
        <p className="font-medium">Páginas de «{silo.label}»</p>
        <p className="text-sm text-muted">
          Ordenadas por enlaces internos entrantes: arriba, lo que el sitio
          está empujando de verdad. {silo.pages > silo.topPages.length &&
            `Se muestran ${silo.topPages.length} de ${silo.pages}.`}
        </p>
      </div>

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Página</th>
              <th className="px-3 py-2 text-right">Entran</th>
              <th className="px-3 py-2 text-right">Salen</th>
              <th className="px-3 py-2 text-right">Prof.</th>
            </tr>
          </thead>
          <tbody>
            {silo.topPages.map((page) => (
              <tr key={page.pageId} className="border-t border-line">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noreferrer"
                      className="link truncate"
                      title={page.title ?? page.url}
                    >
                      {page.path}
                    </a>
                    {page.isHub && (
                      <span className="badge bg-accent/15 text-accent">cabecera</span>
                    )}
                    {!page.indexable && (
                      <span className="badge bg-panel2 text-muted">no indexable</span>
                    )}
                    {page.status != null && page.status >= 400 && (
                      <span className="badge bg-bad/15 text-bad">{page.status}</span>
                    )}
                  </div>
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    page.inlinks === 0 ? 'text-bad' : ''
                  }`}
                >
                  {formatNumber(page.inlinks)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {formatNumber(page.outlinks)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {page.depth}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Matriz de flujo entre secciones.
 *
 * Fila = de dónde sale el enlace, columna = a dónde llega. La diagonal es el
 * enlazado que se queda en casa; cuanto más marcada, mejor silado está el
 * sitio.
 */
function FlowMatrix({
  report,
  onSelect,
}: {
  report: Report;
  onSelect: (key: string) => void;
}) {
  const silos = report.silos.slice(0, 12);
  if (silos.length < 2) return null;

  const counts = new Map(
    report.flows.map((flow) => [`${flow.from} ${flow.to}`, flow.links]),
  );
  const max = Math.max(1, ...report.flows.map((flow) => flow.links));

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Mapa de enlazado entre secciones</h2>
      <p className="text-sm text-muted">
        Cada fila es la sección de origen y cada columna la de destino. La
        diagonal marcada en azul es el enlazado que se queda dentro: si sólo se
        ve la diagonal, el sitio está bien silado; si la cuadrícula está llena,
        todo enlaza con todo.
        {report.silos.length > silos.length &&
          ` Se muestran las ${silos.length} secciones mayores.`}
      </p>

      <div className="overflow-x-auto rounded border border-line p-3">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="p-1" />
              {silos.map((silo) => (
                <th key={silo.key} className="p-1 align-bottom">
                  <div
                    className="mx-auto whitespace-nowrap text-muted"
                    style={{ writingMode: 'vertical-rl', rotate: '180deg' }}
                  >
                    {silo.label}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {silos.map((row) => (
              <tr key={row.key}>
                <th
                  className="cursor-pointer whitespace-nowrap p-1 text-right font-normal text-muted hover:text-fg"
                  onClick={() => onSelect(row.key)}
                >
                  {row.label}
                </th>
                {silos.map((column) => {
                  const links = counts.get(`${row.key} ${column.key}`) ?? 0;
                  const diagonal = row.key === column.key;
                  // Raíz cuadrada: si no, un par dominante deja el resto negro.
                  const intensity = links === 0 ? 0 : Math.sqrt(links / max);
                  return (
                    <td key={column.key} className="p-0.5">
                      <div
                        title={`${row.label} → ${column.label}: ${links} enlaces`}
                        className={`flex h-7 w-7 items-center justify-center rounded-sm tabular-nums ${
                          links === 0 ? 'bg-panel2/40 text-transparent' : 'text-fg'
                        }`}
                        style={
                          links === 0
                            ? undefined
                            : {
                                backgroundColor: diagonal
                                  ? `rgba(79, 157, 255, ${0.15 + intensity * 0.75})`
                                  : `rgba(245, 166, 35, ${0.12 + intensity * 0.6})`,
                              }
                        }
                      >
                        {links > 0 ? (links > 999 ? '999+' : links) : '0'}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : '';
  return (
    <div className="card">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
