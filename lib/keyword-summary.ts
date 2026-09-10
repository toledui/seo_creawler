import { prisma } from '@/lib/prisma';

/**
 * Reparto por posiciones y visibilidad, para las tarjetas del panel.
 *
 * Vive fuera del route handler porque Next.js sólo permite exportar
 * metodos HTTP desde un `route.ts`.
 */
export async function keywordSummary(projectId: string) {
  const [total, tracked, buckets, aggregates, improved, worsened] =
    await Promise.all([
      prisma.keyword.count({ where: { projectId } }),
      prisma.keyword.count({ where: { projectId, tracked: true } }),
      prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
        SELECT CASE
                 WHEN lastPosition IS NULL THEN 'none'
                 WHEN lastPosition <= 3 THEN 'top3'
                 WHEN lastPosition <= 10 THEN 'top10'
                 WHEN lastPosition <= 30 THEN 'top30'
                 ELSE 'rest' END AS bucket,
               COUNT(*) AS count
          FROM \`Keyword\`
         WHERE projectId = ${projectId}
         GROUP BY bucket`,
      prisma.keyword.aggregate({
        where: { projectId, lastPosition: { not: null } },
        _avg: { lastPosition: true },
        _sum: { lastClicks: true, lastImpressions: true },
      }),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM \`Keyword\`
         WHERE projectId = ${projectId}
           AND lastPosition IS NOT NULL
           AND previousPosition IS NOT NULL
           AND lastPosition < previousPosition`,
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM \`Keyword\`
         WHERE projectId = ${projectId}
           AND lastPosition IS NOT NULL
           AND previousPosition IS NOT NULL
           AND lastPosition > previousPosition`,
    ]);

  const bucketMap = Object.fromEntries(
    buckets.map((b) => [b.bucket, Number(b.count)]),
  );

  const serpTracked = await prisma.keyword.count({
    where: { projectId, serpPosition: { not: null } },
  });

  return {
    total,
    tracked,
    serpTracked,
    buckets: {
      top3: bucketMap.top3 ?? 0,
      top10: bucketMap.top10 ?? 0,
      top30: bucketMap.top30 ?? 0,
      rest: bucketMap.rest ?? 0,
      none: bucketMap.none ?? 0,
    },
    averagePosition: aggregates._avg.lastPosition
      ? Number(aggregates._avg.lastPosition.toFixed(2))
      : null,
    totalClicks: aggregates._sum.lastClicks ?? 0,
    totalImpressions: aggregates._sum.lastImpressions ?? 0,
    improved: Number(improved[0]?.count ?? 0),
    worsened: Number(worsened[0]?.count ?? 0),
  };
}
