import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { accessibleOwnerIds } from '@/lib/access';
import { formatDate, formatNumber } from '@/lib/format';
import { CrawlStatusBadge, EmptyState, StatCard, SectionTitle } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();

  // Todo lo visible: lo propio más los espacios compartidos.
  const ownerIds = await accessibleOwnerIds(user.id);

  const [projects, crawls, pageCount, issueCount] = await Promise.all([
    prisma.project.count({ where: { userId: { in: ownerIds } } }),
    prisma.crawl.findMany({
      where: { project: { userId: { in: ownerIds } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.page.count({
      where: { crawl: { project: { userId: { in: ownerIds } } } },
    }),
    prisma.issue.count({
      where: { crawl: { project: { userId: { in: ownerIds } } } },
    }),
  ]);

  const running = crawls.filter((c) =>
    ['RUNNING', 'QUEUED', 'PENDING'].includes(c.status),
  ).length;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Dashboard"
        description={`Bienvenido, ${user.name ?? user.email}`}
        action={
          <Link href="/projects/new" className="btn btn-primary">
            Nuevo proyecto
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Proyectos" value={formatNumber(projects)} href="/projects" />
        <StatCard label="URLs rastreadas" value={formatNumber(pageCount)} />
        <StatCard label="Issues detectados" value={formatNumber(issueCount)} tone="warn" />
        <StatCard
          label="Crawls activos"
          value={formatNumber(running)}
          tone={running > 0 ? 'accent' : 'default'}
        />
      </div>

      <div>
        <SectionTitle title="Crawls recientes" />
        {crawls.length === 0 ? (
          <EmptyState
            title="Aún no has lanzado ningún crawl"
            description="Crea un proyecto, indica el dominio y lanza tu primer rastreo."
            action={
              <Link href="/projects/new" className="btn btn-primary mt-2">
                Crear proyecto
              </Link>
            }
          />
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>URL inicial</th>
                  <th>Estado</th>
                  <th className="text-right">Rastreadas</th>
                  <th className="text-right">Errores</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {crawls.map((crawl) => (
                  <tr key={crawl.id}>
                    <td>
                      <Link className="link" href={`/projects/${crawl.project.id}`}>
                        {crawl.project.name}
                      </Link>
                    </td>
                    <td className="max-w-xs truncate">
                      <Link
                        className="link"
                        href={`/projects/${crawl.project.id}/crawls/${crawl.id}`}
                      >
                        {crawl.startUrl}
                      </Link>
                    </td>
                    <td>
                      <CrawlStatusBadge status={crawl.status} />
                    </td>
                    <td className="text-right tabular-nums">
                      {formatNumber(crawl.crawledUrls)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatNumber(crawl.failedUrls)}
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {formatDate(crawl.createdAt)}
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
