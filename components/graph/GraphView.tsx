'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatNumber } from '@/lib/format';

type GraphNode = {
  id: string;
  url: string;
  path: string;
  title: string | null;
  depth: number;
  pagerank: number;
  status: number | null;
  indexable: boolean;
  inlinks: number;
  outlinks: number;
  directory: string;
  issues: number;
};

type GraphEdge = { source: string; target: string; anchor: string | null };

type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  totalNodes: number;
};

type ColorBy = 'status' | 'depth' | 'indexable' | 'directory' | 'issues';

const PALETTE = [
  '#4f9dff', '#3ecf8e', '#f5a623', '#ff5c5c', '#b06cff',
  '#25c9d0', '#ff8fab', '#a3d900', '#ff9f1c', '#8f9bb3',
];

function colorFor(node: GraphNode, mode: ColorBy, directories: string[]): string {
  switch (mode) {
    case 'status':
      if (node.status == null) return '#ff5c5c';
      if (node.status < 300) return '#3ecf8e';
      if (node.status < 400) return '#f5a623';
      return '#ff5c5c';
    case 'depth': {
      const scale = ['#3ecf8e', '#7bd88f', '#d6d34a', '#f5a623', '#ff7b4a', '#ff5c5c'];
      return scale[Math.min(node.depth, scale.length - 1)];
    }
    case 'indexable':
      return node.indexable ? '#3ecf8e' : '#8f9bb3';
    case 'issues':
      if (node.issues === 0) return '#3ecf8e';
      if (node.issues < 3) return '#f5a623';
      return '#ff5c5c';
    case 'directory': {
      const index = directories.indexOf(node.directory);
      return PALETTE[index === -1 ? PALETTE.length - 1 : index % PALETTE.length];
    }
  }
}

export function GraphView({ crawlId }: { crawlId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<{ kill: () => void; getCanvases: () => Record<string, HTMLCanvasElement>; refresh: () => void } | null>(null);
  const graphRef = useRef<any>(null);

  const [data, setData] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>('status');

  const [filters, setFilters] = useState({
    limit: '1000',
    status: '',
    indexable: '',
    maxDepth: '',
    minInlinks: '',
    maxInlinks: '',
    search: '',
  });

  const directories = data
    ? [...new Set(data.nodes.map((n) => n.directory))].slice(0, 10)
    : [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }

    try {
      const res = await fetch(`/api/crawls/${crawlId}/graph?${params}`, {
        cache: 'no-store',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo cargar el grafo');
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [crawlId, filters]);

  useEffect(() => {
    load();
    // Sólo en el primer render; los cambios de filtro se aplican con el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Construcción / actualización del render de Sigma
  useEffect(() => {
    if (!data || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      const [{ default: Graph }, { default: Sigma }, { default: forceAtlas2 }] =
        await Promise.all([
          import('graphology'),
          import('sigma'),
          import('graphology-layout-forceatlas2'),
        ]);

      if (cancelled || !containerRef.current) return;

      sigmaRef.current?.kill();

      const graph = new Graph({ multi: false, type: 'directed' });

      const ranks = data.nodes.map((n) => n.pagerank);
      const maxRank = Math.max(...ranks, Number.EPSILON);

      data.nodes.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / data.nodes.length;
        const radius = 10 + node.depth * 12;
        graph.addNode(node.id, {
          label: node.path,
          x: Math.cos(angle) * radius + (Math.random() - 0.5) * 4,
          y: Math.sin(angle) * radius + (Math.random() - 0.5) * 4,
          size: 2 + Math.sqrt(node.pagerank / maxRank) * 12,
          color: colorFor(node, colorBy, directories),
          node,
        });
      });

      for (const edge of data.edges) {
        if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
        if (graph.hasEdge(edge.source, edge.target)) continue;
        graph.addDirectedEdge(edge.source, edge.target, {
          size: 0.4,
          color: 'rgba(143,160,181,0.25)',
          anchor: edge.anchor,
        });
      }

      if (graph.order > 1) {
        forceAtlas2.assign(graph, {
          iterations: graph.order > 2000 ? 60 : 150,
          settings: {
            ...forceAtlas2.inferSettings(graph),
            barnesHutOptimize: graph.order > 500,
            gravity: 0.6,
            scalingRatio: 8,
          },
        });
      }

      const renderer = new Sigma(graph, containerRef.current, {
        renderEdgeLabels: false,
        defaultEdgeType: 'arrow',
        labelColor: { color: '#8fa0b5' },
        labelSize: 11,
        labelRenderedSizeThreshold: 8,
        minCameraRatio: 0.05,
        maxCameraRatio: 20,
      });

      renderer.on('clickNode', ({ node }) => {
        setSelected(graph.getNodeAttribute(node, 'node') as GraphNode);
      });
      renderer.on('clickStage', () => setSelected(null));

      graphRef.current = graph;
      sigmaRef.current = renderer as never;
    })();

    return () => {
      cancelled = true;
    };
  }, [data, colorBy]);

  useEffect(() => () => sigmaRef.current?.kill(), []);

  function exportPng() {
    const canvases = sigmaRef.current?.getCanvases();
    if (!canvases) return;

    const layers = Object.values(canvases);
    const first = layers[0];
    const merged = document.createElement('canvas');
    merged.width = first.width;
    merged.height = first.height;

    const ctx = merged.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, merged.width, merged.height);
    for (const layer of layers) ctx.drawImage(layer, 0, 0);

    const link = document.createElement('a');
    link.download = `site-graph-${crawlId.slice(0, 8)}.png`;
    link.href = merged.toDataURL('image/png');
    link.click();
  }

  function exportSvg() {
    const graph = graphRef.current;
    if (!graph || !data) return;

    const positions = data.nodes.map((node) => ({
      node,
      x: graph.getNodeAttribute(node.id, 'x') as number,
      y: graph.getNodeAttribute(node.id, 'y') as number,
      size: graph.getNodeAttribute(node.id, 'size') as number,
      color: graph.getNodeAttribute(node.id, 'color') as string,
    }));

    const xs = positions.map((p) => p.x);
    const ys = positions.map((p) => p.y);
    const pad = 40;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - minX + pad;
    const height = Math.max(...ys) - minY + pad;

    const byId = new Map(positions.map((p) => [p.node.id, p]));

    const edges = data.edges
      .map((e) => {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) return '';
        return `<line x1="${(a.x - minX).toFixed(1)}" y1="${(a.y - minY).toFixed(1)}" x2="${(b.x - minX).toFixed(1)}" y2="${(b.y - minY).toFixed(1)}" stroke="#243040" stroke-width="0.4"/>`;
      })
      .join('');

    const nodes = positions
      .map(
        (p) =>
          `<circle cx="${(p.x - minX).toFixed(1)}" cy="${(p.y - minY).toFixed(1)}" r="${p.size.toFixed(1)}" fill="${p.color}"><title>${p.node.url.replace(/[<>&]/g, '')}</title></circle>`,
      )
      .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}"><rect width="100%" height="100%" fill="#0b0f14"/>${edges}${nodes}</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = `site-graph-${crawlId.slice(0, 8)}.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const setFilter = (key: keyof typeof filters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3">
        <Field label="Nodos máx.">
          <select
            className="input w-auto"
            value={filters.limit}
            onChange={(e) => setFilter('limit')(e.target.value)}
          >
            {['500', '1000', '2000', '5000', '10000'].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Colorear por">
          <select
            className="input w-auto"
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as ColorBy)}
          >
            <option value="status">Status code</option>
            <option value="depth">Profundidad</option>
            <option value="indexable">Indexabilidad</option>
            <option value="directory">Directorio</option>
            <option value="issues">Severidad de issues</option>
          </select>
        </Field>

        <Field label="Status">
          <select
            className="input w-auto"
            value={filters.status}
            onChange={(e) => setFilter('status')(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="2xx">2xx</option>
            <option value="3xx">3xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
          </select>
        </Field>

        <Field label="Indexable">
          <select
            className="input w-auto"
            value={filters.indexable}
            onChange={(e) => setFilter('indexable')(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        </Field>

        <Field label="Depth máx.">
          <input
            type="number"
            className="input w-20"
            value={filters.maxDepth}
            onChange={(e) => setFilter('maxDepth')(e.target.value)}
          />
        </Field>

        <Field label="Inlinks mín.">
          <input
            type="number"
            className="input w-20"
            value={filters.minInlinks}
            onChange={(e) => setFilter('minInlinks')(e.target.value)}
          />
        </Field>

        <Field label="Inlinks máx.">
          <input
            type="number"
            className="input w-20"
            value={filters.maxInlinks}
            onChange={(e) => setFilter('maxInlinks')(e.target.value)}
          />
        </Field>

        <Field label="Buscar URL">
          <input
            className="input w-40"
            value={filters.search}
            onChange={(e) => setFilter('search')(e.target.value)}
            placeholder="/blog/"
          />
        </Field>

        <button className="btn btn-primary" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : 'Aplicar'}
        </button>

        <div className="ml-auto flex gap-2">
          <button className="btn" onClick={exportPng} disabled={!data}>
            PNG
          </button>
          <button className="btn" onClick={exportSvg} disabled={!data}>
            SVG
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {data && (
        <p className="text-xs text-muted">
          Mostrando {formatNumber(data.nodes.length)} nodos y{' '}
          {formatNumber(data.edges.length)} aristas
          {data.truncated &&
            ` · el filtro alcanza ${formatNumber(data.totalNodes)} URLs, sube el límite o afina los filtros`}
          . El tamaño del nodo representa el PageRank interno.
        </p>
      )}

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[70vh] w-full rounded-lg border border-line bg-bg"
        />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-bg/70 text-sm text-muted">
            Calculando layout…
          </div>
        )}

        {selected && (
          <div className="absolute right-3 top-3 w-80 rounded-lg border border-line bg-panel p-3 text-xs shadow-xl">
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="font-medium">Detalle del nodo</span>
              <button className="text-muted hover:text-fg" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <p className="mb-2 break-all font-mono text-[11px] text-accent">
              {selected.url}
            </p>
            {selected.title && <p className="mb-2 text-muted">{selected.title}</p>}
            <dl className="grid grid-cols-2 gap-1">
              <Detail label="Status" value={selected.status ?? 'ERR'} />
              <Detail label="Depth" value={selected.depth} />
              <Detail label="Inlinks" value={formatNumber(selected.inlinks)} />
              <Detail label="Outlinks" value={formatNumber(selected.outlinks)} />
              <Detail label="PageRank" value={selected.pagerank.toExponential(2)} />
              <Detail label="Indexable" value={selected.indexable ? 'Sí' : 'No'} />
              <Detail label="Issues" value={selected.issues} />
              <Detail label="Directorio" value={selected.directory} />
            </dl>
            <Link className="link mt-2 block" href={`/pages/${selected.id}`}>
              Abrir Page Inspector →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}
