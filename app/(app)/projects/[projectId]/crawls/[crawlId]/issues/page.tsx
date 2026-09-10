import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { formatNumber, SEVERITY_ORDER } from '@/lib/format';
import { EmptyState, SectionTitle, SeverityBadge } from '@/components/ui';
import { ruleByCode } from '@/src/seo/rules';

export const dynamic = 'force-dynamic';

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ projectId: string; crawlId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId, crawlId } = await params;

  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, project: { userId: { in: ownerIds } } },
    select: { id: true },
  });
  if (!crawl) notFound();

  const grouped = await prisma.issue.groupBy({
    by: ['code', 'severity', 'title'],
    where: { crawlId },
    _count: { _all: true },
  });

  if (grouped.length === 0) {
    return (
      <EmptyState
        title="Sin issues"
        description="No se han detectado problemas, o el crawl todavía no ha terminado el análisis."
      />
    );
  }

  const sorted = [...grouped].sort((a, b) => {
    const sev =
      SEVERITY_ORDER.indexOf(a.severity as (typeof SEVERITY_ORDER)[number]) -
      SEVERITY_ORDER.indexOf(b.severity as (typeof SEVERITY_ORDER)[number]);
    return sev !== 0 ? sev : b._count._all - a._count._all;
  });

  const base = `/projects/${projectId}/crawls/${crawlId}`;
  const total = sorted.reduce((sum, g) => sum + g._count._all, 0);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Issues"
        description={`${formatNumber(total)} incidencias agrupadas por regla`}
        action={
          <a className="btn" href={`/api/crawls/${crawlId}/export/issues.csv`} download>
            Exportar CSV
          </a>
        }
      />

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Severidad</th>
              <th>Problema</th>
              <th>Descripción</th>
              <th className="text-right">URLs</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((group) => (
              <tr key={group.code}>
                <td>
                  <SeverityBadge severity={group.severity} />
                </td>
                <td>
                  <Link className="link font-medium" href={`${base}/issues/${group.code}`}>
                    {group.title}
                  </Link>
                  <div className="font-mono text-[11px] text-muted">{group.code}</div>
                </td>
                <td className="max-w-md text-xs text-muted">
                  {ruleByCode.get(group.code)?.description ?? '—'}
                </td>
                <td className="text-right tabular-nums font-medium">
                  {formatNumber(group._count._all)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
