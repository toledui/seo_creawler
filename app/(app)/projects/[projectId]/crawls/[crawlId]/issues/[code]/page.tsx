import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { formatNumber, pathOf, truncate } from '@/lib/format';
import { SectionTitle, SeverityBadge } from '@/components/ui';
import { ruleByCode } from '@/src/seo/rules';

export const dynamic = 'force-dynamic';

const PER_PAGE = 100;

export default async function IssueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; crawlId: string; code: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId, crawlId, code } = await params;
  const { page: pageParam } = await searchParams;

  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, project: { userId: { in: ownerIds } } },
    select: { id: true },
  });
  if (!crawl) notFound();

  const page = Math.max(1, Number(pageParam ?? 1));

  const [total, items] = await Promise.all([
    prisma.issue.count({ where: { crawlId, code } }),
    prisma.issue.findMany({
      where: { crawlId, code },
      orderBy: { id: 'asc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
  ]);

  if (total === 0) notFound();

  const rule = ruleByCode.get(code);
  const base = `/projects/${projectId}/crawls/${crawlId}`;
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="space-y-4">
      <Link href={`${base}/issues`} className="link text-sm">
        ← Todos los issues
      </Link>

      <SectionTitle
        title={rule?.title ?? items[0].title}
        description={rule?.description ?? undefined}
        action={
          <div className="flex items-center gap-2">
            <SeverityBadge severity={items[0].severity} />
            <span className="text-sm text-muted">{formatNumber(total)} URLs</span>
          </div>
        }
      />

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>URL</th>
              <th>Detalle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((issue) => (
              <tr key={issue.id.toString()}>
                <td className="font-mono text-xs">
                  {issue.url ? (
                    <span title={issue.url}>{truncate(pathOf(issue.url), 70)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-xs text-muted">{issue.details ?? '—'}</td>
                <td className="text-right">
                  {issue.pageId && (
                    <Link className="link text-xs" href={`/pages/${issue.pageId}`}>
                      Inspeccionar
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link className="btn" href={`${base}/issues/${code}?page=${page - 1}`}>
                ← Anterior
              </Link>
            )}
            {page < totalPages && (
              <Link className="btn" href={`${base}/issues/${code}?page=${page + 1}`}>
                Siguiente →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
