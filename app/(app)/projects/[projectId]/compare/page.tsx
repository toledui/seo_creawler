import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma, serialize } from '@/lib/prisma';
import { formatDate, formatNumber, truncate } from '@/lib/format';
import { EmptyState, SectionTitle, SeverityBadge, StatusBadge } from '@/components/ui';
import { compareCrawls } from '@/src/analysis/compare-crawls';
import { CrawlPicker } from './CrawlPicker';

export const dynamic = 'force-dynamic';

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ base?: string; target?: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId } = await params;
  const { base: baseParam, target: targetParam } = await searchParams;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: { in: ownerIds } },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const crawls = await prisma.crawl.findMany({
    where: { projectId, status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    select: { id: true, startUrl: true, completedAt: true, crawledUrls: true },
  });

  if (crawls.length < 2) {
    return (
      <div className="space-y-5">
        <SectionTitle title="Comparar crawls" description={project.name} />
        <EmptyState
          title="Hacen falta al menos dos crawls completados"
          description="Lanza un segundo rastreo para poder ver qué ha cambiado entre auditorías."
          action={
            <Link
              href={`/projects/${projectId}/crawls/new`}
              className="btn btn-primary mt-2"
            >
              Lanzar crawl
            </Link>
          }
        />
      </div>
    );
  }

  // Por defecto: el más reciente frente al anterior.
  const targetId = targetParam ?? crawls[0].id;
  const baseId = baseParam ?? crawls.find((c) => c.id !== targetId)?.id ?? crawls[1].id;

  const valid =
    crawls.some((c) => c.id === baseId) && crawls.some((c) => c.id === targetId);
  if (!valid) notFound();

  const comparison = serialize(await compareCrawls(baseId, targetId));

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Comparar crawls"
        description="Qué ha cambiado entre dos auditorías del mismo sitio."
      />

      <CrawlPicker
        projectId={projectId}
        crawls={serialize(crawls) as never}
        baseId={baseId}
        targetId={targetId}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        {comparison.metrics.map((m) => {
          const improved = m.higherIsBetter ? m.delta > 0 : m.delta < 0;
          const tone =
            m.delta === 0 ? 'text-muted' : improved ? 'text-ok' : 'text-bad';

          return (
            <div key={m.label} className="card">
              <div className="text-xs uppercase tracking-wide text-muted">
                {m.label}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {formatNumber(Number(m.after.toFixed(2)))}
              </div>
              <div className={`text-xs ${tone}`}>
                {m.delta === 0
                  ? 'sin cambios'
                  : `${m.delta > 0 ? '+' : ''}${Number(m.delta.toFixed(2))} vs ${formatNumber(Number(m.before.toFixed(2)))}`}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChangeTable
          title={`URLs nuevas (${formatNumber(comparison.counts.added)})`}
          rows={comparison.addedUrls}
          empty="No hay URLs nuevas."
          renderValue={(row) => <StatusBadge status={row.after} />}
        />

        <ChangeTable
          title={`URLs desaparecidas (${formatNumber(comparison.counts.removed)})`}
          rows={comparison.removedUrls}
          empty="No ha desaparecido ninguna URL."
          renderValue={(row) => <StatusBadge status={row.before} />}
        />

        <ChangeTable
          title={`Cambios de status (${formatNumber(comparison.counts.statusChanged)})`}
          rows={comparison.statusChanges}
          empty="Ninguna URL cambió de código de estado."
          renderValue={(row) => (
            <span className="flex items-center gap-1">
              <StatusBadge status={row.before} />
              <span className="text-muted">→</span>
              <StatusBadge status={row.after} />
            </span>
          )}
        />

        <ChangeTable
          title={`Cambios de indexabilidad (${formatNumber(comparison.counts.indexabilityChanged)})`}
          rows={comparison.indexabilityChanges}
          empty="Ninguna URL cambió de indexabilidad."
          renderValue={(row) => (
            <span className="text-[11px] text-muted">{row.detail}</span>
          )}
        />
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-3 text-sm font-semibold">Evolución de los issues</h3>
        {comparison.issueDeltas.length === 0 ? (
          <p className="text-sm text-muted">Ningún tipo de issue ha variado.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Severidad</th>
                <th>Problema</th>
                <th className="text-right">Antes</th>
                <th className="text-right">Ahora</th>
                <th className="text-right">Cambio</th>
              </tr>
            </thead>
            <tbody>
              {comparison.issueDeltas.map((issue) => (
                <tr key={issue.code}>
                  <td>
                    <SeverityBadge severity={issue.severity} />
                  </td>
                  <td>
                    <Link
                      className="link"
                      href={`/projects/${projectId}/crawls/${targetId}/issues/${issue.code}`}
                    >
                      {issue.title}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums text-muted">
                    {formatNumber(issue.before)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatNumber(issue.after)}
                  </td>
                  <td
                    className={`text-right tabular-nums ${issue.delta < 0 ? 'text-ok' : 'text-bad'}`}
                  >
                    {issue.delta > 0 ? '+' : ''}
                    {formatNumber(issue.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type Row = {
  url: string;
  pageId: string | null;
  before: number | null;
  after: number | null;
  detail?: string;
};

function ChangeTable({
  title,
  rows,
  empty,
  renderValue,
}: {
  title: string;
  rows: Row[];
  empty: string;
  renderValue: (row: Row) => React.ReactNode;
}) {
  return (
    <div className="card">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="table">
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.url}-${row.pageId ?? 'x'}`}>
                  <td className="font-mono text-[11px]" title={row.url}>
                    {row.pageId ? (
                      <Link className="link" href={`/pages/${row.pageId}`}>
                        {truncate(new URL(row.url).pathname, 45)}
                      </Link>
                    ) : (
                      truncate(new URL(row.url).pathname, 45)
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">{renderValue(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length >= 100 && (
            <p className="mt-2 text-[11px] text-muted">
              Mostrando las 100 primeras por PageRank.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
