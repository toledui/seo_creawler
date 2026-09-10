import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { accessibleOwnerIds } from '@/lib/access';
import { formatDate, formatNumber } from '@/lib/format';
import { EmptyState, SectionTitle } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const user = await requireUser();

  const projects = await prisma.project.findMany({
    where: { userId: { in: await accessibleOwnerIds(user.id) } },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { crawls: true } },
      crawls: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Proyectos"
        description="Cada proyecto agrupa el histórico de crawls de un dominio."
        action={
          <Link href="/projects/new" className="btn btn-primary">
            Nuevo proyecto
          </Link>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No hay proyectos todavía"
          description="Crea el primero indicando un nombre y el dominio a auditar."
          action={
            <Link href="/projects/new" className="btn btn-primary mt-2">
              Crear proyecto
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const last = project.crawls[0];
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="card transition hover:border-accent/50"
              >
                <div className="font-medium">{project.name}</div>
                <div className="truncate text-sm text-muted">{project.domain}</div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>{formatNumber(project._count.crawls)} crawls</span>
                  <span>
                    {last ? `Último: ${formatDate(last.createdAt)}` : 'Sin crawls'}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
