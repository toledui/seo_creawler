import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { formatNumber, pathOf, truncate } from '@/lib/format';
import {
  SectionTitle,
  SeverityBadge,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import type { PageGeoSignals } from '@/src/geo/signals';

export const dynamic = 'force-dynamic';

export default async function PageInspector({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { pageId } = await params;

  let id: bigint;
  try {
    id = BigInt(pageId);
  } catch {
    notFound();
  }

  const page = await prisma.page.findFirst({
    where: { id, crawl: { project: { userId: { in: ownerIds } } } },
    include: {
      crawl: { include: { project: true } },
      headings: { orderBy: { order: 'asc' }, take: 100 },
      images: { take: 100 },
      schemas: true,
      hreflangs: true,
    },
  });

  if (!page) notFound();

  const [issues, inlinks, outlinks, inlinkCount, outlinkCount] = await Promise.all([
    prisma.issue.findMany({ where: { pageId: id }, orderBy: { id: 'asc' } }),
    prisma.link.findMany({
      where: { targetPageId: id },
      take: 100,
      include: { sourcePage: { select: { id: true, normalizedUrl: true } } },
    }),
    prisma.link.findMany({
      where: { sourcePageId: id },
      take: 100,
      include: { targetPage: { select: { id: true, statusCode: true } } },
    }),
    prisma.link.count({ where: { targetPageId: id } }),
    prisma.link.count({ where: { sourcePageId: id } }),
  ]);

  const crawlBase = `/projects/${page.crawl.projectId}/crawls/${page.crawlId}`;
  const geo = page.geoSignals as unknown as PageGeoSignals | null;

  return (
    <div className="space-y-5">
      <Link href={`${crawlBase}/pages`} className="link text-sm">
        ← Inventario de URLs
      </Link>

      <SectionTitle
        title="Page Inspector"
        description={page.normalizedUrl}
        action={
          <a
            className="btn"
            href={page.normalizedUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Abrir URL ↗
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Status" value={<StatusBadge status={page.statusCode} />} />
        <StatCard
          label="Indexable"
          value={page.indexable ? 'Sí' : 'No'}
          tone={page.indexable ? 'ok' : 'warn'}
          hint={page.indexabilityReason}
        />
        <StatCard label="Profundidad" value={page.depth} />
        <StatCard
          label="PageRank interno"
          value={
            page.internalPageRank != null
              ? page.internalPageRank.toExponential(3)
              : '—'
          }
          tone="accent"
        />
        <StatCard label="Inlinks" value={formatNumber(inlinkCount)} />
        <StatCard label="Outlinks internos" value={formatNumber(page.internalOutlinks)} />
        <StatCard label="Enlaces externos" value={formatNumber(page.externalOutlinks)} />
        <StatCard label="Palabras" value={formatNumber(page.wordCount)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">HTTP</h3>
          <Definitions
            rows={[
              ['URL final', page.finalUrl ?? page.normalizedUrl],
              ['Redirect', page.redirectUrl ?? '—'],
              ['Content type', page.contentType ?? '—'],
              [
                'Tiempo de respuesta',
                page.responseTime != null ? `${page.responseTime} ms` : '—',
              ],
              [
                'Tamaño',
                page.contentLength != null
                  ? `${formatNumber(page.contentLength)} bytes`
                  : '—',
              ],
              ['Error', page.errorType ?? '—'],
              ['Descubierta desde', page.discoveredFrom ?? '—'],
              ['Tipo de descubrimiento', page.discoveryType],
              ['En sitemap', page.inSitemap ? 'Sí' : 'No'],
            ]}
          />
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">Metadatos</h3>
          <Definitions
            rows={[
              [
                'Title',
                page.title
                  ? `${page.title} (${page.titleLength} car.)`
                  : '— ausente —',
              ],
              [
                'Meta description',
                page.metaDescription
                  ? `${page.metaDescription} (${page.metaDescriptionLength} car.)`
                  : '— ausente —',
              ],
              ['H1', page.h1 ?? '— ausente —'],
              ['Nº de H1', page.h1Count],
              ['Canonical', page.canonical ?? '—'],
              ['Meta robots', page.metaRobots ?? '—'],
              ['X-Robots-Tag', page.xRobotsTag ?? '—'],
              ['Idioma', page.language ?? '—'],
            ]}
          />
        </div>
      </div>

      {issues.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">Issues ({issues.length})</h3>
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li key={issue.id.toString()} className="flex items-start gap-2 text-sm">
                <SeverityBadge severity={issue.severity} />
                <div>
                  <Link
                    className="link font-medium"
                    href={`${crawlBase}/issues/${issue.code}`}
                  >
                    {issue.title}
                  </Link>
                  {issue.details && (
                    <p className="text-xs text-muted">{issue.details}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">
            Headings ({page.headings.length})
          </h3>
          {page.headings.length === 0 ? (
            <p className="text-sm text-muted">Sin headings.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {page.headings.map((heading) => (
                <li
                  key={heading.id.toString()}
                  style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
                >
                  <span className="mr-2 font-mono text-[11px] text-accent">
                    H{heading.level}
                  </span>
                  {truncate(heading.text, 90)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">
            Imágenes ({page.imagesCount}) · {page.imagesMissingAlt} sin atributo
            alt · {page.imagesDecorative} decorativas
          </h3>
          {page.images.length === 0 ? (
            <p className="text-sm text-muted">Sin imágenes.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Src</th>
                    <th>Alt</th>
                  </tr>
                </thead>
                <tbody>
                  {page.images.map((image) => (
                    <tr key={image.id.toString()}>
                      <td className="font-mono text-[11px]" title={image.src}>
                        {truncate(pathOf(image.src), 45)}
                      </td>
                      {/* Tres estados, nunca mezclados: alt="" es válido. */}
                      <td
                        className={
                          !image.hasAlt ? 'text-xs text-bad' : 'text-xs'
                        }
                      >
                        {!image.hasAlt ? (
                          'sin atributo alt'
                        ) : (image.alt ?? '').trim() === '' ? (
                          <span className="text-muted">decorativa (alt=&quot;&quot;)</span>
                        ) : (
                          truncate(image.alt, 40)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">
            Datos estructurados ({page.schemas.length})
          </h3>
          {page.schemas.length === 0 ? (
            <p className="text-sm text-muted">Sin JSON-LD.</p>
          ) : (
            <ul className="space-y-2">
              {page.schemas.map((schema) => (
                <li key={schema.id.toString()}>
                  <details>
                    <summary className="cursor-pointer text-sm">
                      <span
                        className={`badge mr-2 ${schema.validJson ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}`}
                      >
                        {schema.validJson ? 'válido' : 'JSON inválido'}
                      </span>
                      {schema.schemaType ?? 'sin @type'}
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-bg p-2 text-[11px]">
                      {schema.rawJson.slice(0, 4000)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">Señales GEO</h3>
          {!geo ? (
            <p className="text-sm text-muted">No calculadas para esta página.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              <GeoRow label="Datos estructurados" ok={geo.hasStructuredData} />
              <GeoRow label="Autor identificado" ok={geo.hasAuthor} />
              <GeoRow label="Fecha de publicación" ok={geo.hasPublishedDate} />
              <GeoRow label="Fecha de modificación" ok={geo.hasModifiedDate} />
              <GeoRow label="Breadcrumbs" ok={geo.hasBreadcrumbs} />
              <GeoRow label="FAQPage" ok={geo.hasFaq} />
              <GeoRow label="Jerarquía de headings" ok={geo.headingStructureOk} />
              <GeoRow
                label="Contenido server-rendered"
                ok={geo.hasServerRenderedContent}
              />
              <li className="text-xs text-muted">
                Citas externas: {geo.externalCitations} · ratio texto/HTML:{' '}
                {(geo.textRatio * 100).toFixed(1)}%
              </li>
            </ul>
          )}
          {page.hreflangs.length > 0 && (
            <>
              <h4 className="mb-1 mt-3 text-xs uppercase tracking-wide text-muted">
                Hreflang
              </h4>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {page.hreflangs.map((h) => (
                  <li key={h.id.toString()} className="truncate">
                    <span className="text-accent">{h.language}</span> → {h.href}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">
            Enlaces entrantes ({formatNumber(inlinkCount)})
          </h3>
          {inlinks.length === 0 ? (
            <p className="text-sm text-muted">
              Ninguna página del crawl enlaza a esta URL.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Desde</th>
                    <th>Anchor</th>
                    <th>Follow</th>
                  </tr>
                </thead>
                <tbody>
                  {inlinks.map((link) => (
                    <tr key={link.id.toString()}>
                      <td className="font-mono text-[11px]">
                        <Link className="link" href={`/pages/${link.sourcePage.id}`}>
                          {truncate(pathOf(link.sourcePage.normalizedUrl), 40)}
                        </Link>
                      </td>
                      <td className="text-xs">{truncate(link.anchorText, 40) || '—'}</td>
                      <td className="text-xs">{link.follow ? 'sí' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">
            Enlaces salientes ({formatNumber(outlinkCount)})
          </h3>
          {outlinks.length === 0 ? (
            <p className="text-sm text-muted">Esta página no enlaza a ningún sitio.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Hacia</th>
                    <th>Tipo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outlinks.map((link) => (
                    <tr key={link.id.toString()}>
                      <td className="font-mono text-[11px]" title={link.targetUrl}>
                        {link.targetPage ? (
                          <Link className="link" href={`/pages/${link.targetPage.id}`}>
                            {truncate(link.targetUrl, 45)}
                          </Link>
                        ) : (
                          truncate(link.targetUrl, 45)
                        )}
                      </td>
                      <td className="text-xs text-muted">{link.linkType}</td>
                      <td>
                        {link.targetPage ? (
                          <StatusBadge status={link.targetPage.statusCode} />
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Definitions({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-3 gap-2">
          <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
          <dd className="col-span-2 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function GeoRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <span className={ok ? 'text-ok' : 'text-muted'}>{ok ? '✓' : '✕'}</span>
    </li>
  );
}
