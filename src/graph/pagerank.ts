export type PageRankEdge = { source: string; target: string };

export type PageRankOptions = {
  damping?: number;
  iterations?: number;
  tolerance?: number;
};

/**
 * PageRank interno (sección 22 del plan).
 *
 *   PR(A) = (1-d)/N + d * Σ( PR(T) / C(T) )
 *
 * Los nodos sin salida ("dangling") reparten su rank entre todos,
 * de forma que la suma se mantiene en 1.
 */
export function pagerank(
  nodes: string[],
  edges: PageRankEdge[],
  options: PageRankOptions = {},
): Map<string, number> {
  const damping = options.damping ?? 0.85;
  const iterations = options.iterations ?? 30;
  const tolerance = options.tolerance ?? 1e-6;

  const n = nodes.length;
  const ranks = new Map<string, number>();
  if (n === 0) return ranks;

  const index = new Map<string, number>();
  nodes.forEach((id, i) => index.set(id, i));

  const outDegree = new Float64Array(n);
  const incoming: number[][] = Array.from({ length: n }, () => []);

  for (const edge of edges) {
    const s = index.get(edge.source);
    const t = index.get(edge.target);
    if (s === undefined || t === undefined) continue;
    if (s === t) continue; // los self-links no transfieren rank
    outDegree[s] += 1;
    incoming[t].push(s);
  }

  let current = new Float64Array(n).fill(1 / n);
  let next = new Float64Array(n);

  for (let it = 0; it < iterations; it++) {
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (outDegree[i] === 0) dangling += current[i];
    }

    const base = (1 - damping) / n + (damping * dangling) / n;

    let diff = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (const src of incoming[i]) sum += current[src] / outDegree[src];
      next[i] = base + damping * sum;
      diff += Math.abs(next[i] - current[i]);
    }

    const tmp = current;
    current = next;
    next = tmp;

    if (diff < tolerance) break;
  }

  for (let i = 0; i < n; i++) ranks.set(nodes[i], current[i]);
  return ranks;
}
