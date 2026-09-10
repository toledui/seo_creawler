import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { formatNumber } from '@/lib/format';
import { SectionTitle } from '@/components/ui';
import { EmailReport } from '@/components/EmailReport';

export const dynamic = 'force-dynamic';

export default async function ExportsPage({
  params,
}: {
  params: Promise<{ projectId: string; crawlId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId, crawlId } = await params;

  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, project: { userId: { in: ownerIds } } },
    select: { id: true, stats: true },
  });
  if (!crawl) notFound();

  const [pages, internal, external, issues] = await Promise.all([
    prisma.page.count({ where: { crawlId } }),
    prisma.link.count({ where: { crawlId, linkType: 'INTERNAL' } }),
    prisma.link.count({ where: { crawlId, linkType: 'EXTERNAL' } }),
    prisma.issue.count({ where: { crawlId } }),
  ]);

  const exports = [
    {
      file: 'pages.csv',
      title: 'all-pages.csv',
      description: 'Inventario completo con todas las columnas SEO y de enlazado.',
      count: pages,
    },
    {
      file: 'internal-links.csv',
      title: 'internal-links.csv',
      description: 'Origen, destino, anchor text, rel y status del destino.',
      count: internal,
    },
    {
      file: 'external-links.csv',
      title: 'external-links.csv',
      description: 'Enlaces salientes hacia otros dominios.',
      count: external,
    },
    {
      file: 'issues.csv',
      title: 'issues.csv',
      description: 'Todas las incidencias detectadas por el motor de reglas.',
      count: issues,
    },
  ];

  const hasStats = Boolean(crawl.stats);

  const reportFormats = [
    { file: 'report.pdf', label: 'PDF' },
    { file: 'report.docx', label: 'Word' },
    { file: 'report.md', label: 'Markdown' },
  ];

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Exportaciones"
        description="Los CSV se generan en streaming, sin cargar el crawl completo en memoria."
      />

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Informe del rastreo</p>
            <p className="mt-1 text-xs text-muted">
              Métricas, distribuciones, incidencias, GEO Readiness y
              arquitectura del sitio, maquetado para compartir.
            </p>
          </div>

          {hasStats && (
            <EmailReport
              endpoint={`/api/crawls/${crawlId}/email`}
              label="Enviar por correo"
              compact
            />
          )}
        </div>

        {hasStats ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Descargar:</span>
            {reportFormats.map((format) => (
              <a
                key={format.file}
                className="btn text-xs"
                href={`/api/crawls/${crawlId}/export/${format.file}`}
                download
              >
                {format.label}
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-warn">
            El informe se genera cuando termina el análisis del crawl.
          </p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {exports.map((item) => (
          <div key={item.file} className="card flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-sm">{item.title}</p>
              <p className="text-xs text-muted">{item.description}</p>
              <p className="mt-1 text-xs text-muted">
                {formatNumber(item.count)} filas
              </p>
            </div>
            <a
              className="btn btn-primary shrink-0"
              href={`/api/crawls/${crawlId}/export/${item.file}`}
              download
            >
              Descargar
            </a>
          </div>
        ))}
      </div>

      <div className="card">
        <p className="text-sm font-medium">Exportar el grafo</p>
        <p className="mt-1 text-xs text-muted">
          El grafo se exporta como PNG (captura del render actual) o SVG
          (vectorial, con las posiciones calculadas) desde la propia vista.
        </p>
        <Link
          href={`/projects/${projectId}/crawls/${crawlId}/graph`}
          className="btn mt-3"
        >
          Ir al Site Graph
        </Link>
      </div>
    </div>
  );
}
