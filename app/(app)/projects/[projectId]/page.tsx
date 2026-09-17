import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { formatDate, formatNumber } from '@/lib/format';
import { CrawlStatusBadge, EmptyState, SectionTitle, StatCard } from '@/components/ui';
import { DeleteProjectButton } from './DeleteProjectButton';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: { in: ownerIds } },
    include: { crawls: { orderBy: { createdAt: 'desc' } } },
  });

  if (!project) notFound();

  const lastCompleted = project.crawls.find((c) => c.status === 'COMPLETED');
  const stats = lastCompleted?.stats as
    | { totals?: { pages: number; indexable: number; errors: number }; seoHealth?: number }
    | null;

  return (
    <div className="space-y-6">
      <SectionTitle
        title={project.name}
        description={project.domain}
        action={
          <div className="flex flex-wrap gap-2">
            <DeleteProjectButton projectId={project.id} />
            <Link href={`/projects/${project.id}/keywords`} className="btn">
              Keywords
            </Link>
            {project.crawls.length >= 2 && (
              <Link href={`/projects/${project.id}/compare`} className="btn">
                Comparar crawls
              </Link>
            )}
            <Link
              href={`/projects/${project.id}/crawls/new`}
              className="btn btn-primary"
            >
              Nuevo crawl
            </Link>
          </div>
        }
      />

      {lastCompleted && stats?.totals && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Páginas HTML (último crawl)"
            value={formatNumber(stats.totals.pages)}
          />
          <StatCard
            label="Indexables"
            value={formatNumber(stats.totals.indexable)}
            tone="ok"
          />
          <StatCard label="Errores" value={formatNumber(stats.totals.errors)} tone="bad" />
          <StatCard
            label="SEO Health"
            value={`${stats.seoHealth ?? 0}/100`}
            tone="accent"
          />
        </div>
      )}

      <div>
        <SectionTitle title="Crawls" />
        {project.crawls.length === 0 ? (
          <EmptyState
            title="Este proyecto aún no tiene crawls"
            description="Lanza el primer rastreo para inventariar las URLs del sitio."
            action={
              <Link
                href={`/projects/${project.id}/crawls/new`}
                className="btn btn-primary mt-2"
              >
                Lanzar crawl
              </Link>
            }
          />
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>URL inicial</th>
                  <th>Estado</th>
                  <th className="text-right">Descubiertas</th>
                  <th className="text-right">Rastreadas</th>
                  <th className="text-right">Errores</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                </tr>
              </thead>
              <tbody>
                {project.crawls.map((crawl) => (
                  <tr key={crawl.id}>
                    <td className="max-w-xs truncate">
                      <Link
                        className="link"
                        href={`/projects/${project.id}/crawls/${crawl.id}`}
                      >
                        {crawl.startUrl}
                      </Link>
                    </td>
                    <td>
                      <CrawlStatusBadge status={crawl.status} />
                    </td>
                    <td className="text-right tabular-nums">
                      {formatNumber(crawl.discoveredUrls)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatNumber(crawl.crawledUrls)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatNumber(crawl.failedUrls)}
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {formatDate(crawl.startedAt)}
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {formatDate(crawl.completedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
