import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { formatDuration, formatNumber } from '@/lib/format';
import {
  BarRow,
  EmptyState,
  SectionTitle,
  SeverityBadge,
  StatCard,
} from '@/components/ui';
import { LiveProgress } from '@/components/crawl/LiveProgress';
import {
  isLegacyStats,
  requestedUrlsOf,
  type CrawlStats,
} from '@/src/analysis/analyze-crawl';

export const dynamic = 'force-dynamic';

export default async function CrawlOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string; crawlId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId, crawlId } = await params;

  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, project: { userId: { in: ownerIds } } },
  });
  if (!crawl) notFound();

  const stats = crawl.stats as unknown as CrawlStats | null;
  const base = `/projects/${projectId}/crawls/${crawlId}`;

  // Bloques que sólo existen desde la clasificación de recursos.
  const resources = stats?.resources;
  const images = stats?.images;
  const requestedUrls = stats ? requestedUrlsOf(stats) : 0;

  const duration =
    crawl.startedAt && crawl.completedAt
      ? Math.round(
          (crawl.completedAt.getTime() - crawl.startedAt.getTime()) / 1000,
        )
      : null;

  return (
    <div className="space-y-6">
      <LiveProgress crawlId={crawlId} initialStatus={crawl.status} />

      {!stats ? (
        <EmptyState
          title="Todavía no hay métricas"
          description={
            crawl.status === 'RUNNING' || crawl.status === 'QUEUED'
              ? 'Las métricas y los issues se calculan cuando el crawl termina.'
              : 'Lanza el crawl para generar el inventario y el análisis.'
          }
        />
      ) : (
        <>
          {/* Los crawls anteriores a la clasificación de recursos no traen
              `resources` ni `images`. No se midieron, así que sus paneles se
              omiten en vez de enseñar ceros falsos. */}
          {isLegacyStats(stats) ? (
            <div className="card text-sm text-muted">
              Este rastreo es anterior a la separación entre páginas y recursos:
              sus cifras cuentan imágenes, CSS y JS como si fueran páginas.
              Relanza el rastreo para obtener el inventario de recursos y la
              auditoría de imágenes.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Páginas HTML"
              value={formatNumber(stats.totals.pages)}
              hint={`${formatNumber(requestedUrls)} URLs solicitadas`}
              href={`${base}/pages?kind=pages`}
            />
            <StatCard
              label="Indexables"
              value={formatNumber(stats.totals.indexable)}
              tone="ok"
              hint={`${formatNumber(stats.totals.nonIndexable)} no indexables`}
              href={`${base}/pages?indexable=true`}
            />
            <StatCard
              label="Errores 4xx/5xx"
              value={formatNumber(stats.totals.errors)}
              tone="bad"
              hint="sólo páginas HTML"
              href={`${base}/pages?kind=pages&status=4xx`}
            />
            {resources ? (
              <StatCard
                label="Recursos descubiertos"
                value={formatNumber(resources.discovered)}
                hint={`${formatNumber(resources.images)} imágenes · ${formatNumber(resources.broken)} rotos`}
                href={`${base}/pages?kind=assets`}
              />
            ) : null}
            <StatCard
              label="Redirecciones"
              value={formatNumber(stats.totals.redirects)}
              tone="warn"
              href={`${base}/pages?status=3xx`}
            />
            <StatCard
              label="SEO Health"
              value={`${stats.seoHealth}/100`}
              tone={stats.seoHealth >= 80 ? 'ok' : stats.seoHealth >= 60 ? 'warn' : 'bad'}
              href={`${base}/issues`}
            />
            <StatCard
              label="GEO Readiness"
              value={`${stats.geo.score}/100`}
              tone={stats.geo.score >= 70 ? 'ok' : 'warn'}
              href={`${base}/geo`}
            />
            <StatCard
              label="Profundidad media"
              value={stats.totals.averageDepth.toFixed(2)}
            />
            <StatCard
              label="Enlaces"
              value={formatNumber(stats.totals.internalLinks)}
              hint={`${formatNumber(stats.totals.externalLinks)} externos`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">
                Códigos de estado
                <span className="ml-1 font-normal text-muted">
                  · sobre {formatNumber(requestedUrls)} URLs solicitadas
                </span>
              </h3>
              {Object.entries(stats.statusDistribution).map(([bucket, count]) => (
                <BarRow
                  key={bucket}
                  label={bucket}
                  value={count}
                  total={requestedUrls}
                  color={
                    bucket === '2xx'
                      ? 'bg-ok'
                      : bucket === '3xx'
                        ? 'bg-warn'
                        : bucket === 'error'
                          ? 'bg-bad'
                          : bucket.startsWith('4') || bucket.startsWith('5')
                            ? 'bg-bad'
                            : 'bg-accent'
                  }
                  href={bucket !== 'error' ? `${base}/pages?status=${bucket}` : undefined}
                />
              ))}
            </div>

            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">
                Distribución de profundidad
              </h3>
              {Object.entries(stats.depthDistribution).map(([depth, count]) => (
                <BarRow
                  key={depth}
                  label={`Nivel ${depth}`}
                  value={count}
                  total={stats.totals.pages}
                  color={Number(depth) > 4 ? 'bg-warn' : 'bg-accent'}
                  href={`${base}/pages?minDepth=${depth}&maxDepth=${depth}`}
                />
              ))}
            </div>

            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">
                Indexabilidad
                <span className="ml-1 font-normal text-muted">
                  · sobre {formatNumber(stats.totals.pages)} páginas HTML
                </span>
              </h3>
              {Object.entries(stats.indexabilityDistribution).map(([reason, count]) => (
                <BarRow
                  key={reason}
                  label={reason}
                  value={count}
                  total={stats.totals.pages}
                  color={reason === 'INDEXABLE' ? 'bg-ok' : 'bg-panel2 border border-line'}
                  href={`${base}/pages?reason=${reason}`}
                />
              ))}
            </div>

            {resources ? (
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">
                Recursos descubiertos
                <span className="ml-1 font-normal text-muted">
                  · no se auditan con reglas de páginas
                </span>
              </h3>
              {Object.entries(resources.byType)
                .filter(([type]) => type !== 'HTML_PAGE')
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <BarRow
                    key={type}
                    label={type}
                    value={count}
                    total={requestedUrls}
                    color="bg-panel2 border border-line"
                    href={`${base}/pages?resourceType=${type}`}
                  />
                ))}
              {resources.discovered === 0 ? (
                <p className="text-sm text-muted">Sin recursos no-HTML.</p>
              ) : null}
            </div>
            ) : null}

            {images && resources ? (
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">
                Imágenes en páginas HTML
                <span className="ml-1 font-normal text-muted">
                  · sobre {formatNumber(images.elements)} elementos &lt;img&gt;
                </span>
              </h3>
              {images.elements === 0 ? (
                <p className="text-sm text-muted">Sin imágenes auditadas.</p>
              ) : (
                <>
                  <BarRow
                    label="Sin atributo alt"
                    value={images.missingAlt}
                    total={images.elements}
                    color="bg-bad"
                  />
                  <BarRow
                    label='Decorativas (alt="")'
                    value={images.decorativeAlt}
                    total={images.elements}
                    color="bg-panel2 border border-line"
                  />
                  <BarRow
                    label="Con alt descriptivo"
                    value={images.describedAlt}
                    total={images.elements}
                    color="bg-ok"
                  />
                  <p className="mt-2 text-xs text-muted">
                    {formatNumber(images.pagesWithMissingAlt)} páginas
                    afectadas · {formatNumber(resources.brokenImages)} de{' '}
                    {formatNumber(resources.images)} imágenes solicitadas
                    están rotas.
                  </p>
                </>
              )}
            </div>
            ) : null}

            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">Top issues</h3>
              {stats.topIssues.length === 0 ? (
                <p className="text-sm text-muted">Sin issues detectados.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {stats.topIssues.slice(0, 10).map((issue) => (
                    <li key={issue.code} className="flex items-center gap-2">
                      <SeverityBadge severity={issue.severity} />
                      <Link
                        className="link flex-1 truncate"
                        href={`${base}/issues/${issue.code}`}
                      >
                        {issue.title}
                      </Link>
                      <span className="tabular-nums text-muted">
                        {formatNumber(issue.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card">
            <SectionTitle title="Directorios" />
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Directorio</th>
                    <th className="text-right">Páginas</th>
                    <th className="text-right">Indexables</th>
                    <th className="text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.directories.map((dir) => (
                    <tr key={dir.directory}>
                      <td>
                        <Link
                          className="link font-mono text-xs"
                          href={`${base}/pages?directory=${encodeURIComponent(dir.directory)}`}
                        >
                          {dir.directory}
                        </Link>
                      </td>
                      <td className="text-right tabular-nums">
                        {formatNumber(dir.pages)}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatNumber(dir.indexable)}
                      </td>
                      <td className="text-right tabular-nums text-muted">
                        {Math.round((dir.indexable / dir.pages) * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Info label="Duración" value={formatDuration(duration)} />
            <Info
              label="Tiempo de respuesta medio"
              value={`${formatNumber(stats.totals.averageResponseTime)} ms`}
            />
            <Info
              label="Palabras por página"
              value={formatNumber(stats.totals.averageWordCount)}
            />
            <Info label="Max URLs configurado" value={formatNumber(crawl.maxUrls)} />
          </div>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
