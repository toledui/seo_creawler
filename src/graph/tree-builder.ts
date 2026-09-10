import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  isSystemPath,
  siloKeyFor,
  slugKeyFor,
  type SiloGrouping,
} from './silo-analyzer';

export type TreeMode = 'path' | 'link' | 'inlinks' | 'cluster' | 'silo';

export type TreeFilters = {
  mode?: TreeMode;
  limit?: number;
  /** Modo `inlinks`: URL (o fragmento) de la página desde la que mirar atrás. */
  focus?: string;
  maxDepth?: number;
  status?: string;
  indexable?: boolean;
  directory?: string;
  search?: string;
  /** Modo `silo`: agrupar por carpeta de la URL o por tema del slug. */
  grouping?: SiloGrouping;
};

export type TreeNode = {
  id: string;
  label: string;
  kind: 'root' | 'folder' | 'page' | 'cluster' | 'silo';
  /** Texto auxiliar: anchor del enlace, tamaño del cluster, etc. */
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
  /** Páginas que cuelgan de aquí pero no se dibujan por el límite. */
  hiddenChildren: number;
  /** Total de páginas en el subárbol, incluidas las ocultas. */
  subtreeSize: number;
  children: TreeNode[];
};

export type TreePayload = {
  mode: TreeMode;
  root: TreeNode;
  totalPages: number;
  renderedPages: number;
  truncated: boolean;
  /** Modo `inlinks`: la página desde la que se está mirando hacia atrás. */
  focusUrl?: string | null;
  /** Enlaces internos que NO forman parte del árbol (referencias cruzadas). */
  crossLinks: { source: string; target: string }[];
};

type PageRow = {
  id: bigint;
  normalizedUrl: string;
  title: string | null;
  statusCode: number | null;
  depth: number;
  internalPageRank: number | null;
  internalInlinks: number;
  internalOutlinks: number;
  indexable: boolean;
  clusterId: number | null;
  contentType: string | null;
};

function labelForPath(segment: string): string {
  return decodeURIComponent(segment) || '/';
}

function emptyNode(partial: Partial<TreeNode> & { id: string; label: string; kind: TreeNode['kind'] }): TreeNode {
  return {
    detail: null,
    url: null,
    pageId: null,
    status: null,
    depth: 0,
    pagerank: 0,
    inlinks: 0,
    outlinks: 0,
    indexable: true,
    issues: 0,
    clusterId: null,
    hiddenChildren: 0,
    subtreeSize: 0,
    children: [],
    ...partial,
  };
}

async function loadPages(
  crawlId: string,
  filters: TreeFilters,
  take: number,
): Promise<{ rows: PageRow[]; total: number }> {
  const where: Prisma.PageWhereInput = { crawlId };

  if (filters.status) {
    const ranges: Record<string, Prisma.PageWhereInput> = {
      '2xx': { statusCode: { gte: 200, lt: 300 } },
      '3xx': { statusCode: { gte: 300, lt: 400 } },
      '4xx': { statusCode: { gte: 400, lt: 500 } },
      '5xx': { statusCode: { gte: 500 } },
      error: { statusCode: null },
    };
    Object.assign(where, ranges[filters.status] ?? {});
  }

  if (filters.indexable !== undefined) where.indexable = filters.indexable;
  if (filters.directory) where.directory = filters.directory;
  if (filters.search) where.normalizedUrl = { contains: filters.search };
  if (filters.maxDepth !== undefined) where.depth = { lte: filters.maxDepth };

  const [total, rows] = await Promise.all([
    prisma.page.count({ where }),
    prisma.page.findMany({
      where,
      // Priorizamos por PageRank: si hay que recortar, se pierden las hojas
      // menos relevantes, no la estructura principal.
      orderBy: [{ depth: 'asc' }, { internalPageRank: 'desc' }],
      take,
      select: {
        id: true,
        normalizedUrl: true,
        title: true,
        statusCode: true,
        depth: true,
        internalPageRank: true,
        internalInlinks: true,
        internalOutlinks: true,
        indexable: true,
        clusterId: true,
        contentType: true,
      },
    }),
  ]);

  return { rows, total };
}

async function issueCountsFor(ids: bigint[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const counts = await prisma.issue.groupBy({
    by: ['pageId'],
    where: { pageId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(counts.map((c) => [c.pageId!.toString(), c._count._all]));
}

function pageNode(row: PageRow, label: string, issues: number): TreeNode {
  return emptyNode({
    id: `p${row.id}`,
    label,
    kind: 'page',
    url: row.normalizedUrl,
    pageId: row.id.toString(),
    status: row.statusCode,
    depth: row.depth,
    pagerank: row.internalPageRank ?? 0,
    inlinks: row.internalInlinks,
    outlinks: row.internalOutlinks,
    indexable: row.indexable,
    issues,
    clusterId: row.clusterId,
  });
}

/** Etiqueta corta para una URL: el último segmento del path, o el host. */
function shortLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/') return parsed.hostname;
    return parsed.pathname.split('/').filter(Boolean).pop() ?? '/';
  } catch {
    return url;
  }
}

/**
 * Árbol por estructura de URL.
 *
 * `/blog/guia-seo` cuelga de `/blog/`, que cuelga de la raíz. Siempre
 * produce un árbol limpio y es la vista más intuitiva para entender cómo
 * está organizado el sitio, independientemente de cómo esté enlazado.
 */
function buildPathTree(rows: PageRow[], issues: Map<string, number>): TreeNode {
  const root = emptyNode({ id: 'root', label: '/', kind: 'root' });
  const folders = new Map<string, TreeNode>([['', root]]);

  // Ordenar por longitud de path garantiza que los padres existan antes.
  const sorted = [...rows].sort(
    (a, b) => a.normalizedUrl.length - b.normalizedUrl.length,
  );

  for (const row of sorted) {
    let segments: string[];
    try {
      segments = new URL(row.normalizedUrl).pathname.split('/').filter(Boolean);
    } catch {
      continue;
    }

    const issueCount = issues.get(row.id.toString()) ?? 0;

    if (segments.length === 0) {
      // La home: sus datos van al propio nodo raíz.
      Object.assign(root, {
        url: row.normalizedUrl,
        pageId: row.id.toString(),
        status: row.statusCode,
        depth: row.depth,
        pagerank: row.internalPageRank ?? 0,
        inlinks: row.internalInlinks,
        outlinks: row.internalOutlinks,
        indexable: row.indexable,
        issues: issueCount,
        clusterId: row.clusterId,
        label: new URL(row.normalizedUrl).hostname,
      });
      continue;
    }

    // Creamos (o reutilizamos) los directorios intermedios.
    let parent = root;
    let prefix = '';

    for (let i = 0; i < segments.length - 1; i++) {
      prefix += `/${segments[i]}`;
      let folder = folders.get(prefix);
      if (!folder) {
        folder = emptyNode({
          id: `f${prefix}`,
          label: labelForPath(segments[i]),
          kind: 'folder',
        });
        folders.set(prefix, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }

    const fullPath = `/${segments.join('/')}`;
    const existing = folders.get(fullPath);

    if (existing) {
      // Ya existía como carpeta (ej. /blog/ con hijos): le damos sus datos.
      Object.assign(existing, {
        kind: 'page',
        url: row.normalizedUrl,
        pageId: row.id.toString(),
        status: row.statusCode,
        depth: row.depth,
        pagerank: row.internalPageRank ?? 0,
        inlinks: row.internalInlinks,
        outlinks: row.internalOutlinks,
        indexable: row.indexable,
        issues: issueCount,
        clusterId: row.clusterId,
      });
      continue;
    }

    const node = pageNode(row, labelForPath(segments[segments.length - 1]), issueCount);
    node.id = `f${fullPath}`;
    folders.set(fullPath, node);
    parent.children.push(node);
  }

  return root;
}

/**
 * Árbol por camino de rastreo.
 *
 * Hace un BFS sobre los enlaces internos partiendo de la home, de modo
 * que el padre de cada URL es la página desde la que se llega en el menor
 * número de clics. Responde a "¿cómo llega Google hasta aquí?".
 *
 * No se usa la profundidad guardada en `Page`: cuando el sitemap siembra
 * todas las URLs, todas quedan a profundidad 0 y no habría jerarquía que
 * deducir. El BFS la reconstruye a partir del enlazado real.
 */
async function buildLinkTree(
  crawlId: string,
  rows: PageRow[],
  issues: Map<string, number>,
): Promise<{ root: TreeNode; crossLinks: { source: string; target: string }[] }> {
  const byId = new Map(rows.map((r) => [r.id.toString(), r]));
  const ids = rows.map((r) => r.id);

  const links = await prisma.link.findMany({
    where: {
      crawlId,
      linkType: 'INTERNAL',
      sourcePageId: { in: ids },
      targetPageId: { in: ids },
    },
    select: { sourcePageId: true, targetPageId: true },
  });

  // Adyacencia, ordenando los destinos por PageRank para que, a igual
  // distancia, el padre elegido sea el enlace más relevante.
  const adjacency = new Map<string, string[]>();
  for (const link of links) {
    const source = link.sourcePageId.toString();
    const target = link.targetPageId!.toString();
    if (source === target) continue;
    const list = adjacency.get(source);
    if (list) list.push(target);
    else adjacency.set(source, [target]);
  }

  // Raíz: la home si está, y si no la URL con más PageRank.
  const homeCandidates = rows.filter((row) => {
    try {
      return new URL(row.normalizedUrl).pathname === '/';
    } catch {
      return false;
    }
  });

  const rootRow =
    homeCandidates[0] ??
    [...rows].sort(
      (a, b) => (b.internalPageRank ?? 0) - (a.internalPageRank ?? 0),
    )[0];

  const nodes = new Map<string, TreeNode>();
  for (const row of rows) {
    const id = row.id.toString();
    let label: string;
    try {
      const parsed = new URL(row.normalizedUrl);
      label =
        parsed.pathname === '/'
          ? parsed.hostname
          : parsed.pathname.split('/').filter(Boolean).pop() ?? '/';
    } catch {
      label = row.normalizedUrl;
    }
    nodes.set(id, pageNode(row, label, issues.get(id) ?? 0));
  }

  const parentOf = new Map<string, string>();
  const bfsDepth = new Map<string, number>();

  if (rootRow) {
    const rootId = rootRow.id.toString();
    bfsDepth.set(rootId, 0);

    const queue: string[] = [rootId];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const currentDepth = bfsDepth.get(current)!;

      const targets = (adjacency.get(current) ?? []).slice().sort(
        (a, b) =>
          (byId.get(b)?.internalPageRank ?? 0) -
          (byId.get(a)?.internalPageRank ?? 0),
      );

      for (const target of targets) {
        if (bfsDepth.has(target)) continue; // ya alcanzado por un camino más corto
        bfsDepth.set(target, currentDepth + 1);
        parentOf.set(target, current);
        queue.push(target);
      }
    }
  }

  const root = emptyNode({ id: 'root', label: 'Sitio', kind: 'root' });
  const orphans = emptyNode({
    id: 'orphans',
    label: 'Sin ruta desde la home',
    kind: 'folder',
  });

  // La profundidad que se muestra es la del BFS: los clics reales.
  for (const [id, depth] of bfsDepth) {
    const node = nodes.get(id);
    if (node) node.depth = depth;
  }

  for (const row of rows) {
    const id = row.id.toString();
    const node = nodes.get(id)!;
    const parentId = parentOf.get(id);

    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(node);
    } else if (rootRow && id === rootRow.id.toString()) {
      root.children.push(node);
    } else {
      orphans.children.push(node);
    }
  }

  if (orphans.children.length > 0) root.children.push(orphans);

  // Con una sola raíz real y sin huérfanas, el árbol arranca en la home.
  const realRoots = root.children.filter((c) => c.id !== 'orphans');
  if (realRoots.length === 1 && orphans.children.length === 0) {
    return { root: realRoots[0], crossLinks: [] };
  }

  // Enlaces que no forman parte del árbol: referencias cruzadas.
  const treeEdges = new Set(
    [...parentOf.entries()].map(([child, parent]) => `${parent}->${child}`),
  );
  const crossLinks: { source: string; target: string }[] = [];
  for (const link of links) {
    const source = link.sourcePageId.toString();
    const target = link.targetPageId!.toString();
    if (source === target) continue;
    if (treeEdges.has(`${source}->${target}`)) continue;
    if (crossLinks.length >= 3000) break;
    crossLinks.push({ source: `p${source}`, target: `p${target}` });
  }

  return { root, crossLinks };
}

/**
 * Árbol inverso: quién enlaza hacia una página.
 *
 * Es el reflejo del modo "camino de rastreo". En lugar de bajar desde la
 * home, se parte de una URL concreta y se sube por sus enlaces entrantes:
 * los hijos de cada nodo son las páginas que le enlazan.
 *
 * Responde a la pregunta de negocio "¿qué posts están alimentando a esta
 * página?", que es justo lo que no se ve ni en el grafo ni en el árbol
 * descendente. Cada nodo lleva el anchor text con el que se le enlaza.
 */
async function buildInlinkTree(
  crawlId: string,
  rows: PageRow[],
  issues: Map<string, number>,
  focus: string | undefined,
): Promise<{ root: TreeNode; focusUrl: string | null }> {
  const byId = new Map(rows.map((r) => [r.id.toString(), r]));
  const ids = rows.map((r) => r.id);

  // Página foco: la indicada, o la de mayor PageRank si no se indica.
  let focusRow: PageRow | undefined;

  if (focus) {
    const needle = focus.toLowerCase();
    focusRow =
      rows.find((r) => r.normalizedUrl.toLowerCase() === needle) ??
      rows.find((r) => r.normalizedUrl.toLowerCase().includes(needle));
  }

  focusRow ??= [...rows].sort(
    (a, b) => (b.internalPageRank ?? 0) - (a.internalPageRank ?? 0),
  )[0];

  if (!focusRow) {
    return {
      root: emptyNode({ id: 'root', label: 'Sin páginas', kind: 'root' }),
      focusUrl: null,
    };
  }

  const links = await prisma.link.findMany({
    where: {
      crawlId,
      linkType: 'INTERNAL',
      sourcePageId: { in: ids },
      targetPageId: { in: ids },
    },
    select: { sourcePageId: true, targetPageId: true, anchorText: true },
  });

  // Adyacencia invertida: destino -> quiénes le enlazan.
  const inboundOf = new Map<string, { source: string; anchor: string | null }[]>();
  for (const link of links) {
    const source = link.sourcePageId.toString();
    const target = link.targetPageId!.toString();
    if (source === target) continue;
    const list = inboundOf.get(target);
    if (list) list.push({ source, anchor: link.anchorText });
    else inboundOf.set(target, [{ source, anchor: link.anchorText }]);
  }

  const focusId = focusRow.id.toString();
  const visited = new Set<string>([focusId]);

  const makeNode = (row: PageRow, anchor: string | null, level: number): TreeNode => {
    const node = pageNode(
      row,
      shortLabel(row.normalizedUrl),
      issues.get(row.id.toString()) ?? 0,
    );
    // La profundidad pasa a significar "saltos de enlace hasta el foco".
    node.depth = level;
    node.detail = anchor ? `anchor: "${anchor.slice(0, 60)}"` : null;
    return node;
  };

  const root = makeNode(focusRow, null, 0);
  root.detail = `${focusRow.internalInlinks} enlaces internos entrantes`;

  // BFS hacia atrás. Cada página aparece una sola vez, en el nivel más
  // cercano al foco, para que el árbol no se dispare por los menús.
  const queue: { node: TreeNode; id: string; level: number }[] = [
    { node: root, id: focusId, level: 0 },
  ];

  const MAX_LEVELS = 4;

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current.level >= MAX_LEVELS) continue;

    const inbound = (inboundOf.get(current.id) ?? [])
      .filter((entry) => !visited.has(entry.source))
      .sort(
        (a, b) =>
          (byId.get(b.source)?.internalPageRank ?? 0) -
          (byId.get(a.source)?.internalPageRank ?? 0),
      );

    for (const entry of inbound) {
      if (visited.has(entry.source)) continue;
      const row = byId.get(entry.source);
      if (!row) continue;

      visited.add(entry.source);
      const child = makeNode(row, entry.anchor, current.level + 1);
      current.node.children.push(child);
      queue.push({ node: child, id: entry.source, level: current.level + 1 });
    }
  }

  return { root, focusUrl: focusRow.normalizedUrl };
}

/**
 * Árbol por cluster de enlazado (Louvain).
 *
 * Agrupa las URLs por la comunidad que forman sus enlaces internos, no por
 * el directorio de la URL. Es la vista que responde de un vistazo a "¿cómo
 * están mis clusters?": cuántos hay, qué tamaño tienen, cuál es su página
 * principal y cuánto enlace reciben desde fuera del propio cluster.
 */
async function buildClusterTree(
  crawlId: string,
  rows: PageRow[],
  issues: Map<string, number>,
): Promise<TreeNode> {
  const root = emptyNode({ id: 'root', label: 'Clusters', kind: 'root' });

  const grouped = new Map<number | null, PageRow[]>();
  for (const row of rows) {
    const key = row.clusterId;
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }

  // Enlaces que entran a cada cluster desde otro cluster: mide aislamiento.
  const inbound = await prisma.$queryRaw<{ clusterId: number; inbound: bigint }[]>`
    SELECT tp.clusterId, COUNT(*) AS inbound
      FROM Link l
      JOIN Page sp ON sp.id = l.sourcePageId
      JOIN Page tp ON tp.id = l.targetPageId
     WHERE l.crawlId = ${crawlId}
       AND l.linkType = 'INTERNAL'
       AND tp.clusterId IS NOT NULL
       AND sp.clusterId IS NOT NULL
       AND sp.clusterId <> tp.clusterId
     GROUP BY tp.clusterId`;

  const inboundByCluster = new Map(
    inbound.map((r) => [r.clusterId, Number(r.inbound)]),
  );

  const clusters = [...grouped.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );

  for (const [clusterId, pages] of clusters) {
    const sorted = [...pages].sort(
      (a, b) => (b.internalPageRank ?? 0) - (a.internalPageRank ?? 0),
    );

    const top = sorted[0];
    const external = clusterId == null ? 0 : inboundByCluster.get(clusterId) ?? 0;
    const avgDepth =
      pages.reduce((sum, p) => sum + p.depth, 0) / Math.max(1, pages.length);

    // El cluster se nombra por la carpeta dominante de sus URLs: es lo que
    // hace reconocible el grupo de un vistazo.
    const directories = new Map<string, number>();
    for (const page of pages) {
      let dir = '/';
      try {
        const segments = new URL(page.normalizedUrl).pathname
          .split('/')
          .filter(Boolean);
        dir = segments.length > 0 ? `/${segments[0]}` : '/';
      } catch {
        /* ignoramos URLs no parseables */
      }
      directories.set(dir, (directories.get(dir) ?? 0) + 1);
    }
    const dominant = [...directories.entries()].sort((a, b) => b[1] - a[1])[0];

    const clusterNode = emptyNode({
      id: `c${clusterId ?? 'none'}`,
      label:
        clusterId == null
          ? 'Sin cluster (no indexables)'
          : `${dominant?.[0] ?? '/'} · cluster ${clusterId}`,
      kind: 'cluster',
      clusterId: clusterId ?? null,
      pagerank: top?.internalPageRank ?? 0,
      detail: [
        `${pages.length} URLs`,
        `profundidad media ${avgDepth.toFixed(1)}`,
        clusterId == null
          ? null
          : `${external} enlaces desde otros clusters`,
        top ? `principal: ${shortLabel(top.normalizedUrl)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });

    for (const page of sorted) {
      clusterNode.children.push(
        pageNode(
          page,
          shortLabel(page.normalizedUrl),
          issues.get(page.id.toString()) ?? 0,
        ),
      );
    }

    root.children.push(clusterNode);
  }

  return root;
}

/**
 * Árbol por silo.
 *
 * A diferencia del modo `cluster`, que dibuja las comunidades que Louvain
 * descubre, aquí los grupos son las secciones que tú definiste: la carpeta
 * de la URL o el tema del slug. Cada rama lleva cuántos de sus enlaces se
 * quedan dentro, que es la señal de si el silo se sostiene o reparte fuerza
 * a todo el sitio.
 */
async function buildSiloTree(
  crawlId: string,
  rows: PageRow[],
  issues: Map<string, number>,
  grouping: SiloGrouping,
): Promise<TreeNode> {
  const root = emptyNode({
    id: 'root',
    label: grouping === 'slug' ? 'Temas' : 'Silos',
    kind: 'root',
  });

  const siloOf = new Map<string, string>();
  const grouped = new Map<string, PageRow[]>();

  for (const row of rows) {
    // Sólo documentos: las imágenes de /wp-content/uploads y las rutas de
    // infraestructura no forman parte de la arquitectura editorial y, si se
    // cuelan, aparecen como si fueran la sección más grande del sitio.
    if (row.contentType && !row.contentType.startsWith('text/html')) continue;
    if (isSystemPath(row.normalizedUrl)) continue;

    const key =
      grouping === 'slug'
        ? slugKeyFor(row.normalizedUrl)
        : siloKeyFor(row.normalizedUrl, 1);
    siloOf.set(row.id.toString(), key);
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }

  // Enlaces internos de las páginas dibujadas, para separar los que se
  // quedan en el silo de los que salen.
  const links = await prisma.link.findMany({
    where: {
      crawlId,
      linkType: 'INTERNAL',
      targetPageId: { not: null },
      sourcePageId: { in: rows.map((row) => row.id) },
    },
    select: { sourcePageId: true, targetPageId: true },
  });

  const inside = new Map<string, number>();
  const outside = new Map<string, number>();
  const incoming = new Map<string, number>();

  for (const link of links) {
    const from = siloOf.get(link.sourcePageId.toString());
    const to = siloOf.get(link.targetPageId!.toString());
    if (from === undefined || to === undefined) continue;

    if (from === to) inside.set(from, (inside.get(from) ?? 0) + 1);
    else {
      outside.set(from, (outside.get(from) ?? 0) + 1);
      incoming.set(to, (incoming.get(to) ?? 0) + 1);
    }
  }

  const silos = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);

  silos.forEach(([key, pages], index) => {
    const sorted = [...pages].sort(
      (a, b) => b.internalInlinks - a.internalInlinks ||
        (b.internalPageRank ?? 0) - (a.internalPageRank ?? 0),
    );

    const within = inside.get(key) ?? 0;
    const out = outside.get(key) ?? 0;
    const emitted = within + out;
    const cohesion = emitted > 0 ? within / emitted : 0;

    const siloNode = emptyNode({
      id: `s:${key}`,
      label:
        key === '/'
          ? grouping === 'slug'
            ? 'Sin tema común'
            : 'Raíz del sitio'
          : key,
      kind: 'silo',
      // Sirve sólo para que la vista pinte cada silo de un color estable.
      clusterId: index,
      pagerank: pages.reduce((sum, page) => sum + (page.internalPageRank ?? 0), 0),
      inlinks: incoming.get(key) ?? 0,
      outlinks: out,
      detail: [
        `${pages.length} URLs`,
        `${Math.round(cohesion * 100)} % del enlazado se queda dentro`,
        `${incoming.get(key) ?? 0} enlaces desde otras secciones`,
      ].join(' · '),
    });

    for (const page of sorted) {
      siloNode.children.push(
        pageNode(
          page,
          shortLabel(page.normalizedUrl),
          issues.get(page.id.toString()) ?? 0,
        ),
      );
    }

    root.children.push(siloNode);
  });

  return root;
}

/** Recorta subárboles demasiado anchos y calcula tamaños agregados. */
function pruneAndMeasure(node: TreeNode, maxChildren: number): number {
  if (node.children.length > maxChildren) {
    // Conservamos los hijos con más PageRank: la estructura relevante.
    node.children.sort((a, b) => b.pagerank - a.pagerank);
    const removed = node.children.splice(maxChildren);
    // Páginas ocultas de verdad. La fórmula anterior sumaba un extra por
    // cada hijo, así que una lista plana de URLs se contaba por duplicado:
    // 72 páginas recortadas se anunciaban como "+144".
    node.hiddenChildren = removed.reduce(
      (sum, child) => sum + countPages(child),
      0,
    );
  }

  let size = node.kind === 'page' ? 1 : 0;
  for (const child of node.children) size += pruneAndMeasure(child, maxChildren);
  size += node.hiddenChildren;

  node.subtreeSize = size;

  // Los hijos se ordenan por relevancia para que el dibujo sea estable.
  node.children.sort((a, b) => b.subtreeSize - a.subtreeSize || b.pagerank - a.pagerank);

  return size;
}

function countPages(node: TreeNode): number {
  let count = node.kind === 'page' ? 1 : 0;
  for (const child of node.children) count += countPages(child);
  return count;
}

const MAX_CHILDREN_PER_NODE = 40;

/**
 * Construye la vista jerárquica del sitio.
 *
 * El grafo de fuerzas mostraba "todo conectado con todo" porque cada menú
 * y cada footer generan enlaces desde cualquier página. Aquí se elige un
 * único padre por URL, así que el resultado es un árbol legible.
 */
export async function buildTree(
  crawlId: string,
  filters: TreeFilters = {},
): Promise<TreePayload> {
  const allowed: TreeMode[] = ['path', 'link', 'inlinks', 'cluster', 'silo'];
  const mode: TreeMode = allowed.includes(filters.mode as TreeMode)
    ? (filters.mode as TreeMode)
    : 'path';

  const limit = Math.min(Math.max(filters.limit ?? 1500, 10), 10_000);

  const { rows, total } = await loadPages(crawlId, filters, limit);
  const issues = await issueCountsFor(rows.map((r) => r.id));

  let root: TreeNode;
  let crossLinks: { source: string; target: string }[] = [];
  let focusUrl: string | null = null;

  switch (mode) {
    case 'link': {
      const built = await buildLinkTree(crawlId, rows, issues);
      root = built.root;
      crossLinks = built.crossLinks;
      break;
    }
    case 'inlinks': {
      const built = await buildInlinkTree(crawlId, rows, issues, filters.focus);
      root = built.root;
      focusUrl = built.focusUrl;
      break;
    }
    case 'cluster':
      root = await buildClusterTree(crawlId, rows, issues);
      break;
    case 'silo':
      root = await buildSiloTree(
        crawlId,
        rows,
        issues,
        filters.grouping ?? 'path',
      );
      break;
    default:
      root = buildPathTree(rows, issues);
  }

  pruneAndMeasure(root, MAX_CHILDREN_PER_NODE);

  return {
    mode,
    root,
    totalPages: total,
    renderedPages: rows.length,
    truncated: total > rows.length,
    crossLinks,
    focusUrl,
  };
}
