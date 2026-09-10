'use client';

import { useEffect, useState } from 'react';
import { formatDate, formatNumber, truncate } from '@/lib/format';

type TopResult = {
  rank: number | null;
  domain: string | null;
  url: string | null;
  title: string | null;
};

type SerpData = {
  keyword: {
    keyword: string;
    serpPosition: number | null;
    serpPreviousPosition: number | null;
    serpBestPosition: number | null;
    serpUrl: string | null;
    serpCheckedAt: string | null;
  };
  latest: {
    date: string;
    rankAbsolute: number | null;
    rankGroup: number | null;
    url: string | null;
    found: boolean;
    featureTypes: string[];
    topResults: TopResult[];
    totalResults: string | null;
    device: string;
    locationCode: number;
    languageCode: string;
  } | null;
  history: { date: string; position: number | null; found: boolean }[];
};

/** Etiquetas legibles para los bloques del SERP. */
const FEATURE_LABELS: Record<string, string> = {
  organic: 'Resultados orgánicos',
  paid: 'Anuncios',
  featured_snippet: 'Fragmento destacado',
  people_also_ask: 'Preguntas relacionadas',
  local_pack: 'Pack local (Maps)',
  related_searches: 'Búsquedas relacionadas',
  images: 'Imágenes',
  video: 'Vídeos',
  top_stories: 'Noticias',
  shopping: 'Shopping',
  knowledge_graph: 'Knowledge graph',
  answer_box: 'Caja de respuesta',
  discussions_and_forums: 'Foros y debates',
};

/**
 * Ficha del SERP de una keyword: dónde sales tú y quién ocupa el top.
 *
 * Los datos ya están pagados y guardados, así que abrirla no cuesta nada.
 */
export function SerpDetail({
  projectId,
  keywordId,
  ownDomain,
  onClose,
}: {
  projectId: string;
  keywordId: string;
  ownDomain: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<SerpData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/projects/${projectId}/keywords/${keywordId}/serp?days=90`, {
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [projectId, keywordId]);

  if (loading) return <div className="card text-sm text-muted">Cargando SERP…</div>;
  if (!data) return null;

  const { keyword, latest, history } = data;
  const measured = history.filter((h) => h.position != null);

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{keyword.keyword}</p>
          <p className="text-xs text-muted">
            {latest
              ? `${latest.device} · ${latest.languageCode} · geo ${latest.locationCode} · medido ${formatDate(latest.date)}`
              : 'Sin mediciones todavía'}
          </p>
        </div>
        <button className="text-muted hover:text-fg" onClick={onClose}>
          ✕
        </button>
      </div>

      {!latest && (
        <p className="text-sm text-muted">
          Esta keyword aún no se ha medido en el SERP. Usa &quot;Medir
          ahora&quot; para consultarla.
        </p>
      )}

      {latest && (
        <>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Info
              label="Tu posición"
              value={
                latest.found
                  ? `#${latest.rankGroup ?? latest.rankAbsolute}`
                  : 'Fuera del top'
              }
              tone={
                !latest.found
                  ? 'bad'
                  : (latest.rankGroup ?? 99) <= 3
                    ? 'ok'
                    : (latest.rankGroup ?? 99) <= 10
                      ? 'accent'
                      : 'warn'
              }
            />
            <Info
              label="Mejor histórico"
              value={keyword.serpBestPosition ? `#${keyword.serpBestPosition}` : '—'}
            />
            <Info
              label="Puesto absoluto"
              value={latest.rankAbsolute ? `#${latest.rankAbsolute}` : '—'}
            />
            <Info
              label="Resultados totales"
              value={
                latest.totalResults
                  ? formatNumber(Number(latest.totalResults))
                  : '—'
              }
            />
          </div>

          {latest.url && (
            <p className="break-all font-mono text-[11px] text-accent">
              {latest.url}
            </p>
          )}

          {latest.featureTypes.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
                Bloques presentes en el SERP
              </p>
              <div className="flex flex-wrap gap-1">
                {latest.featureTypes.map((feature) => (
                  <span
                    key={feature}
                    className="badge bg-panel2 text-muted"
                    title={feature}
                  >
                    {FEATURE_LABELS[feature] ?? feature}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                Los bloques dicen qué hay que ganar además del enlace azul:
                preguntas relacionadas y fragmentos destacados se atacan con
                contenido estructurado.
              </p>
            </div>
          )}

          {latest.topResults.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
                Quién ocupa el top
              </p>
              <div className="max-h-64 overflow-y-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>Dominio</th>
                      <th>Título</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.topResults.map((result, i) => {
                      const isOwn =
                        result.domain?.replace(/^www\./, '') ===
                        ownDomain.replace(/^www\./, '');
                      return (
                        <tr key={i} className={isOwn ? 'bg-accent/10' : ''}>
                          <td className="tabular-nums text-muted">{result.rank}</td>
                          <td className={isOwn ? 'font-medium text-accent' : ''}>
                            {result.domain ?? '—'}
                            {isOwn && ' (tú)'}
                          </td>
                          <td className="text-xs text-muted">
                            {truncate(result.title, 60)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {measured.length > 1 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
                Evolución ({measured.length} mediciones)
              </p>
              <PositionChart history={history} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Sparkline con el eje invertido: la posición 1 va arriba. */
function PositionChart({
  history,
}: {
  history: { date: string; position: number | null }[];
}) {
  const points = history.filter((h) => h.position != null);
  if (points.length < 2) return null;

  const width = 640;
  const height = 120;
  const pad = 10;

  const positions = points.map((p) => p.position!);
  const worst = Math.max(...positions, 10);
  const best = Math.min(...positions, 1);
  const range = Math.max(1, worst - best);

  const coords = points.map((point, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = pad + ((point.position! - best) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full min-w-[380px]">
        <path d={`M${coords.join(' L')}`} fill="none" stroke="#3ecf8e" strokeWidth={2} />
      </svg>
      <p className="text-[11px] text-muted">
        Del puesto {best} (arriba) al {worst} (abajo)
      </p>
    </div>
  );
}

function Info({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad' | 'accent';
}) {
  const tones = {
    ok: 'text-ok',
    warn: 'text-warn',
    bad: 'text-bad',
    accent: 'text-accent',
  };

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`font-medium ${tone ? tones[tone] : ''}`}>{value}</div>
    </div>
  );
}
