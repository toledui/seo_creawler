import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { formatNumber } from '@/lib/format';
import { BarRow, EmptyState, SectionTitle, StatCard } from '@/components/ui';
import type { CrawlStats } from '@/src/analysis/analyze-crawl';

export const dynamic = 'force-dynamic';

export default async function GeoPage({
  params,
}: {
  params: Promise<{ crawlId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { crawlId } = await params;

  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, project: { userId: { in: ownerIds } } },
    select: { stats: true },
  });
  if (!crawl) notFound();

  const stats = crawl.stats as unknown as CrawlStats | null;

  if (!stats) {
    return (
      <EmptyState
        title="Sin datos GEO"
        description="Las señales GEO se calculan al finalizar el crawl."
      />
    );
  }

  const schemaCoverage = await prisma.$queryRaw<
    { schemaType: string; pages: bigint }[]
  >`
    SELECT s.schemaType, COUNT(DISTINCT s.pageId) AS pages
      FROM SchemaMarkup s
      JOIN Page p ON p.id = s.pageId
     WHERE p.crawlId = ${crawlId} AND s.schemaType IS NOT NULL
     GROUP BY s.schemaType ORDER BY pages DESC LIMIT 20`;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="GEO Readiness"
        description="Señales verificables de preparación para motores generativos. Cada categoría es explicable: no hay puntuación opaca."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Score GEO"
          value={`${stats.geo.score}/100`}
          tone={stats.geo.score >= 70 ? 'ok' : stats.geo.score >= 45 ? 'warn' : 'bad'}
        />
        <StatCard
          label="Páginas indexables"
          value={formatNumber(stats.totals.indexable)}
        />
        <StatCard
          label="Tipos de schema"
          value={formatNumber(schemaCoverage.length)}
        />
        <StatCard
          label="SEO Health"
          value={`${stats.seoHealth}/100`}
          tone="accent"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">Categorías</h3>
          <div className="space-y-3">
            {stats.geo.categories.map((category) => (
              <div key={category.key}>
                <BarRow
                  label={`${category.label} — ${category.score}/${category.max}`}
                  value={category.score}
                  total={category.max}
                  color={
                    category.score / category.max >= 0.7
                      ? 'bg-ok'
                      : category.score / category.max >= 0.4
                        ? 'bg-warn'
                        : 'bg-bad'
                  }
                />
                <p className="text-xs text-muted">{category.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">Cobertura de datos estructurados</h3>
          {schemaCoverage.length === 0 ? (
            <p className="text-sm text-muted">
              No se detectó JSON-LD en las páginas rastreadas.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {schemaCoverage.map((row) => (
                <BarRow
                  key={row.schemaType}
                  label={row.schemaType}
                  value={Number(row.pages)}
                  total={stats.totals.pages}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
