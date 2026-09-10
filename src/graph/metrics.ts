import Graph from 'graphology';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import hits from 'graphology-metrics/centrality/hits';
import louvain from 'graphology-communities-louvain';

export type MetricEdge = { source: string; target: string };

export type GraphMetrics = {
  betweenness: Map<string, number>;
  hubs: Map<string, number>;
  authorities: Map<string, number>;
  communities: Map<string, number>;
  communityCount: number;
  modularity: number | null;
};

/** Grafos grandes: el betweenness exacto es O(V·E) y se dispara. */
const BETWEENNESS_NODE_LIMIT = 5_000;

function toMap(record: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(record));
}

/**
 * Métricas avanzadas de arquitectura interna (sección 21 del plan):
 *
 * - **Betweenness**: cuántas rutas de navegación pasan por una página. Un
 *   valor alto señala un cuello de botella: si esa URL desaparece, partes
 *   del sitio quedan mucho más lejos.
 * - **Hub / Authority (HITS)**: hubs son páginas que enlazan bien hacia
 *   contenido valioso (categorías, índices); authorities son las que reciben
 *   enlaces desde buenos hubs (fichas, artículos de referencia).
 * - **Comunidades (Louvain)**: agrupa las URLs por densidad de enlazado
 *   real, no por directorio, lo que revela los clusters temáticos
 *   efectivos y los silos aislados.
 */
export function computeGraphMetrics(
  nodes: string[],
  edges: MetricEdge[],
): GraphMetrics {
  const empty: GraphMetrics = {
    betweenness: new Map(),
    hubs: new Map(),
    authorities: new Map(),
    communities: new Map(),
    communityCount: 0,
    modularity: null,
  };

  if (nodes.length === 0) return empty;

  const directed = new Graph({ type: 'directed', multi: false });
  for (const node of nodes) directed.addNode(node);
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!directed.hasNode(edge.source) || !directed.hasNode(edge.target)) continue;
    if (directed.hasDirectedEdge(edge.source, edge.target)) continue;
    directed.addDirectedEdge(edge.source, edge.target);
  }

  if (directed.size === 0) {
    // Sin aristas no hay nada que medir, pero cada nodo es su propio cluster.
    return {
      ...empty,
      communities: new Map(nodes.map((n, i) => [n, i])),
      communityCount: nodes.length,
    };
  }

  // ---- Betweenness
  let betweenness = new Map<string, number>();
  if (directed.order <= BETWEENNESS_NODE_LIMIT) {
    betweenness = toMap(
      betweennessCentrality(directed, { normalized: true }) as Record<string, number>,
    );
  }

  // ---- HITS
  let hubs = new Map<string, number>();
  let authorities = new Map<string, number>();
  try {
    const result = hits(directed, { maxIterations: 100, normalize: true });
    hubs = toMap(result.hubs);
    authorities = toMap(result.authorities);
  } catch {
    // HITS no converge en algunos grafos degenerados; no es crítico.
  }

  // ---- Louvain necesita un grafo no dirigido
  const undirected = new Graph({ type: 'undirected', multi: false });
  for (const node of nodes) undirected.addNode(node);
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!undirected.hasNode(edge.source) || !undirected.hasNode(edge.target)) continue;
    if (undirected.hasEdge(edge.source, edge.target)) continue;
    undirected.addUndirectedEdge(edge.source, edge.target);
  }

  let communities = new Map<string, number>();
  let modularity: number | null = null;
  try {
    const detailed = louvain.detailed(undirected, { resolution: 1 });
    communities = toMap(detailed.communities);
    modularity = detailed.modularity ?? null;
  } catch {
    communities = new Map(nodes.map((n, i) => [n, i]));
  }

  const communityCount = new Set(communities.values()).size;

  return {
    betweenness,
    hubs,
    authorities,
    communities,
    communityCount,
    modularity,
  };
}
