'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hierarchy, tree as d3tree, type HierarchyPointNode } from 'd3-hierarchy';
import { formatNumber, truncate } from '@/lib/format';

type TreeNode = {
  id: string;
  label: string;
  kind: 'root' | 'folder' | 'page' | 'cluster' | 'silo';
  detail: string | null;
  url: string | null;
  pageId: string | null;
  status: number | null;
  depth: number;
  pagerank: number;
  inlinks: number;
  outlinks: number;
  indexable: boolean;
  issues: number;
  clusterId: number | null;
  hiddenChildren: number;
  subtreeSize: number;
  children: TreeNode[];
};

type TreeMode = 'path' | 'link' | 'inlinks' | 'cluster' | 'silo';

type TreePayload = {
  mode: TreeMode;
  root: TreeNode;
  totalPages: number;
  renderedPages: number;
  truncated: boolean;
  focusUrl?: string | null;
};

const MODE_HELP: Record<TreeMode, string> = {
  path: 'Cada URL cuelga de su carpeta. Muestra cómo está organizado el sitio.',
  link: 'Camino más corto en clics desde la home hasta cada URL.',
  inlinks:
    'Al revés: la raíz es la página elegida y sus hijos son las páginas que la enlazan.',
  cluster:
    'Agrupado por comunidades de enlazado (Louvain), no por carpetas: así se leen los clusters reales.',
  silo:
    'Agrupado por las secciones que tú definiste. Cada rama indica qué parte de su enlazado se queda dentro del silo y cuántos enlaces recibe de fuera.',
};

type ColorBy = 'status' | 'depth' | 'indexable' | 'issues' | 'cluster';

const CLUSTER_PALETTE = [
  '#4f9dff', '#3ecf8e', '#f5a623', '#b06cff', '#25c9d0',
  '#ff8fab', '#a3d900', '#ff9f1c', '#7f8cff', '#ff5c5c',
];

function colorFor(node: TreeNode, mode: ColorBy): string {
  if (node.kind === 'cluster' || node.kind === 'silo') {
    return node.clusterId == null
      ? '#5f7288'
      : CLUSTER_PALETTE[node.clusterId % CLUSTER_PALETTE.length];
  }
  if (node.kind !== 'page') return '#5f7288';

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
    case 'cluster':
      if (node.clusterId == null) return '#5f7288';
      return CLUSTER_PALETTE[node.clusterId % CLUSTER_PALETTE.length];
  }
}

/** Radio del nodo según su PageRank, con un mínimo legible. */
function radiusFor(node: TreeNode, maxRank: number): number {
  if (node.kind === 'cluster' || node.kind === 'silo') return 7;
  if (node.kind === 'folder') return 4;
  const ratio = maxRank > 0 ? node.pagerank / maxRank : 0;
  return 4 + Math.sqrt(ratio) * 10;
}

const NODE_HEIGHT = 26;
const LEVEL_WIDTH = 230;

export function TreeView({ crawlId }: { crawlId: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const [data, setData] = useState<TreePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>('status');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [transform, setTransform] = useState({ x: 60, y: 0, k: 1 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const [filters, setFilters] = useState({
    mode: 'path' as TreeMode,
    grouping: 'path',
    focus: '',
    limit: '1500',
    status: '',
    indexable: '',
    maxDepth: '',
    search: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }

    try {
      const res = await fetch(`/api/crawls/${crawlId}/tree?${params}`, {
        cache: 'no-store',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'No se pudo cargar el árbol');
      setData(body);
      // Colapsamos de entrada para que el árbol no explote a lo alto.
      // En cluster la gracia es comparar los grupos entre sí, y en el modo
      // inverso lo que importa primero son los enlaces directos al foco:
      // en ambos casos basta con el primer nivel abierto.
      const collapseFrom =
        body.mode === 'cluster' ||
        body.mode === 'silo' ||
        body.mode === 'inlinks'
          ? 1
          : 2;
      const autoCollapse = new Set<string>();
      const walk = (node: TreeNode, level: number) => {
        if (level >= collapseFrom && node.children.length > 0) {
          autoCollapse.add(node.id);
        }
        node.children.forEach((child) => walk(child, level + 1));
      };
      walk(body.root, 0);
      setCollapsed(autoCollapse);
      setTransform({
        x: 60,
        y: (svgRef.current?.clientHeight ?? 600) / 2,
        k: 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [crawlId, filters]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Layout tidy tree
  const layout = useMemo(() => {
    if (!data) return null;

    const root = hierarchy<TreeNode>(data.root, (node) =>
      collapsed.has(node.id) ? [] : node.children,
    );

    const count = root.descendants().length;
    const layoutTree = d3tree<TreeNode>()
      .nodeSize([NODE_HEIGHT, LEVEL_WIDTH])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.4));

    const positioned = layoutTree(root);
    const nodes = positioned.descendants();
    const links = positioned.links();

    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    let maxRank = 0;

    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
      maxRank = Math.max(maxRank, node.data.pagerank);
    }

    return { nodes, links, minX, maxX, maxY, maxRank, count };
  }, [data, collapsed]);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setCollapsed(new Set());
  }

  function collapseToLevel(level: number) {
    if (!data) return;
    const next = new Set<string>();
    const walk = (node: TreeNode, current: number) => {
      if (current >= level && node.children.length > 0) next.add(node.id);
      node.children.forEach((child) => walk(child, current + 1));
    };
    walk(data.root, 0);
    setCollapsed(next);
  }

  // ---- Pan y zoom
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setTransform((t) => {
      const k = Math.min(4, Math.max(0.15, t.k * factor));
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { ...t, k };
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      return {
        k,
        x: mx - ((mx - t.x) * k) / t.k,
        y: my - ((my - t.y) * k) / t.k,
      };
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    setTransform((t) => ({
      ...t,
      x: drag.tx + (e.clientX - drag.x),
      y: drag.ty + (e.clientY - drag.y),
    }));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function fitToScreen() {
    if (!layout || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const width = layout.maxY + 240;
    const height = layout.maxX - layout.minX + 80;
    const k = Math.min(rect.width / width, rect.height / height, 1.5);
    setTransform({
      k,
      x: 40,
      y: rect.height / 2 - ((layout.minX + layout.maxX) / 2) * k,
    });
  }

  function resetZoom() {
    setTransform({
      x: 60,
      y: (svgRef.current?.clientHeight ?? 600) / 2,
      k: 1,
    });
  }

  // ---- Exportaciones
  function svgMarkup(): string | null {
    const svg = svgRef.current;
    if (!svg || !layout) return null;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    const width = (layout.maxY + 280) * 1;
    const height = layout.maxX - layout.minX + 120;

    clone.setAttribute('width', String(Math.ceil(width)));
    clone.setAttribute('height', String(Math.ceil(height)));
    clone.setAttribute('viewBox', `0 0 ${Math.ceil(width)} ${Math.ceil(height)}`);

    const group = clone.querySelector('g');
    if (group) {
      // En el fichero exportado dibujamos el árbol completo desde arriba a
      // la izquierda, sin el zoom ni el paneo que haya en pantalla.
      group.setAttribute('transform', `translate(40, ${-layout.minX + 60})`);
    }

    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', '#0b0f14');
    clone.insertBefore(background, clone.firstChild);

    return new XMLSerializer().serializeToString(clone);
  }

  function download(blob: Blob, filename: string) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportSvg() {
    const markup = svgMarkup();
    if (!markup) return;
    download(
      new Blob([markup], { type: 'image/svg+xml' }),
      `site-tree-${crawlId.slice(0, 8)}.svg`,
    );
  }

  async function rasterize(scale = 2): Promise<Blob | null> {
    const markup = svgMarkup();
    if (!markup || !layout) return null;

    const width = Math.ceil(layout.maxY + 280);
    const height = Math.ceil(layout.maxX - layout.minX + 120);

    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function exportPng() {
    const blob = await rasterize(2);
    if (blob) download(blob, `site-tree-${crawlId.slice(0, 8)}.png`);
  }

  async function exportPdf() {
    const blob = await rasterize(2);
    if (!blob) return;

    const buffer = await blob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((acc, byte) => acc + String.fromCharCode(byte), ''),
    );

    const res = await fetch(`/api/crawls/${crawlId}/export/graph.pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        png: base64,
        title: `Arquitectura del sitio · ${data?.mode === 'link' ? 'camino de rastreo' : 'estructura de URL'}`,
        subtitle: `${formatNumber(data?.renderedPages ?? 0)} URLs representadas`,
      }),
    });

    if (!res.ok) {
      setError('No se pudo generar el PDF');
      return;
    }

    download(await res.blob(), `site-tree-${crawlId.slice(0, 8)}.pdf`);
  }

  const setFilter = (key: keyof typeof filters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3">
        <Field label="Jerarquía">
          <select
            className="input w-auto"
            value={filters.mode}
            onChange={(e) => setFilter('mode')(e.target.value)}
          >
            <option value="path">Estructura de URL</option>
            <option value="link">Camino de rastreo</option>
            <option value="inlinks">Quién enlaza aquí (inverso)</option>
            <option value="cluster">Clusters de enlazado</option>
            <option value="silo">Silos (secciones)</option>
          </select>
        </Field>

        {filters.mode === 'silo' && (
          <Field label="Agrupar por">
            <select
              className="input w-auto"
              value={filters.grouping}
              onChange={(e) => setFilter('grouping')(e.target.value)}
            >
              <option value="path">Carpeta de la URL</option>
              <option value="slug">Tema del slug</option>
            </select>
          </Field>
        )}

        {filters.mode === 'inlinks' && (
          <Field label="Página foco">
            <input
              className="input w-52"
              value={filters.focus}
              onChange={(e) => setFilter('focus')(e.target.value)}
              placeholder="/servicios/seo (vacío = mayor PageRank)"
            />
          </Field>
        )}

        <Field label="Colorear por">
          <select
            className="input w-auto"
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as ColorBy)}
          >
            <option value="status">Status code</option>
            <option value="depth">Profundidad</option>
            <option value="indexable">Indexabilidad</option>
            <option value="issues">Issues</option>
            <option value="cluster">Cluster (Louvain)</option>
          </select>
        </Field>

        <Field label="URLs máx.">
          <select
            className="input w-auto"
            value={filters.limit}
            onChange={(e) => setFilter('limit')(e.target.value)}
          >
            {['500', '1500', '3000', '5000', '10000'].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
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

        <Field label="Buscar URL">
          <input
            className="input w-36"
            value={filters.search}
            onChange={(e) => setFilter('search')(e.target.value)}
            placeholder="/blog/"
          />
        </Field>

        <button className="btn btn-primary" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : 'Aplicar'}
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-2 py-2 text-xs">
        <span className="text-muted">Vista:</span>
        <button className="btn text-xs" onClick={expandAll}>
          Expandir todo
        </button>
        <button className="btn text-xs" onClick={() => collapseToLevel(1)}>
          Nivel 1
        </button>
        <button className="btn text-xs" onClick={() => collapseToLevel(2)}>
          Nivel 2
        </button>
        <button className="btn text-xs" onClick={() => collapseToLevel(3)}>
          Nivel 3
        </button>
        <button className="btn text-xs" onClick={fitToScreen}>
          Ajustar
        </button>
        <button className="btn text-xs" onClick={resetZoom}>
          100%
        </button>

        <div className="ml-auto flex gap-2">
          <button className="btn text-xs" onClick={exportSvg} disabled={!data}>
            SVG
          </button>
          <button className="btn text-xs" onClick={exportPng} disabled={!data}>
            PNG
          </button>
          <button className="btn text-xs" onClick={exportPdf} disabled={!data}>
            PDF
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
          <span className="text-fg">{MODE_HELP[data.mode]}</span>
          {data.mode === 'inlinks' && data.focusUrl && (
            <>
              {' '}
              Foco: <span className="font-mono text-accent">{data.focusUrl}</span>
            </>
          )}
        </p>
      )}

      {data && layout && (
        <p className="text-xs text-muted">
          {formatNumber(layout.count)} nodos visibles de{' '}
          {formatNumber(data.renderedPages)} URLs cargadas
          {data.truncated &&
            ` (el filtro alcanza ${formatNumber(data.totalPages)}; sube el límite para verlas todas)`}
          . El tamaño del nodo representa el PageRank interno. Haz clic en el
          círculo hueco para plegar o desplegar una rama.
        </p>
      )}

      <div className="relative overflow-hidden rounded-lg border border-line bg-bg">
        <svg
          ref={svgRef}
          className="h-[72vh] w-full cursor-grab active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
            {layout?.links.map((link, i) => {
              const source = link.source as HierarchyPointNode<TreeNode>;
              const target = link.target as HierarchyPointNode<TreeNode>;
              const midY = (source.y + target.y) / 2;
              return (
                <path
                  key={i}
                  d={`M${source.y},${source.x} C${midY},${source.x} ${midY},${target.x} ${target.y},${target.x}`}
                  fill="none"
                  stroke="#243040"
                  strokeWidth={1.2}
                />
              );
            })}

            {layout?.nodes.map((node) => {
              const data = node.data;
              const hasChildren = data.children.length > 0;
              const isCollapsed = collapsed.has(data.id);
              const r = radiusFor(data, layout.maxRank);

              return (
                <g
                  key={data.id}
                  transform={`translate(${node.y}, ${node.x})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(data);
                  }}
                  className="cursor-pointer"
                >
                  <circle
                    r={r}
                    fill={isCollapsed && hasChildren ? '#0b0f14' : colorFor(data, colorBy)}
                    stroke={colorFor(data, colorBy)}
                    strokeWidth={isCollapsed && hasChildren ? 2 : 0}
                    onClick={(e) => {
                      if (!hasChildren) return;
                      e.stopPropagation();
                      toggle(data.id);
                    }}
                  />

                  {data.issues > 0 && (
                    <circle r={2} cx={r + 4} cy={-r} fill="#ff5c5c" />
                  )}

                  <text
                    x={r + 6}
                    y={4}
                    fontSize={11}
                    fill={selected?.id === data.id ? '#e6edf5' : '#8fa0b5'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {truncate(data.label, 28)}
                    {isCollapsed && hasChildren && ` (${data.subtreeSize})`}
                    {data.hiddenChildren > 0 && ` +${data.hiddenChildren}`}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/70 text-sm text-muted">
            Construyendo el árbol…
          </div>
        )}

        {selected && (
          <div className="absolute right-3 top-3 w-80 rounded-lg border border-line bg-panel p-3 text-xs shadow-xl">
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="font-medium">
                {selected.kind === 'folder' ? 'Directorio' : 'Detalle del nodo'}
              </span>
              <button
                className="text-muted hover:text-fg"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>

            {selected.url ? (
              <p className="mb-2 break-all font-mono text-[11px] text-accent">
                {selected.url}
              </p>
            ) : (
              <p className="mb-2 font-mono text-[11px] text-muted">
                {selected.label} · agrupa {formatNumber(selected.subtreeSize)} URLs
              </p>
            )}

            {selected.detail && (
              <p className="mb-2 text-[11px] text-muted">{selected.detail}</p>
            )}

            <dl className="grid grid-cols-2 gap-1">
              {selected.kind === 'page' && (
                <>
                  <Detail label="Status" value={selected.status ?? 'ERR'} />
                  <Detail
                    label={data?.mode === 'inlinks' ? 'Saltos al foco' : 'Depth'}
                    value={selected.depth}
                  />
                  <Detail label="Inlinks" value={formatNumber(selected.inlinks)} />
                  <Detail label="Outlinks" value={formatNumber(selected.outlinks)} />
                  <Detail label="PageRank" value={selected.pagerank.toExponential(2)} />
                  <Detail label="Indexable" value={selected.indexable ? 'Sí' : 'No'} />
                  <Detail label="Issues" value={selected.issues} />
                  <Detail
                    label="Cluster"
                    value={selected.clusterId ?? '—'}
                  />
                </>
              )}
              <Detail
                label={
                  data?.mode === 'inlinks' ? 'Enlazan (directa o indirectamente)' : 'URLs en la rama'
                }
                value={formatNumber(selected.subtreeSize)}
              />
            </dl>

            {selected.pageId && (
              <Link className="link mt-2 block" href={`/pages/${selected.pageId}`}>
                Abrir Page Inspector →
              </Link>
            )}
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
