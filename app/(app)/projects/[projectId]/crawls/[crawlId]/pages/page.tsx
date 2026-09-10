import { Suspense } from 'react';
import { PagesTable } from '@/components/tables/PagesTable';
import { SectionTitle } from '@/components/ui';

export default async function CrawlPagesPage({
  params,
}: {
  params: Promise<{ crawlId: string }>;
}) {
  const { crawlId } = await params;

  return (
    <div>
      <SectionTitle
        title="Inventario de URLs"
        description="Paginación, orden y filtros se resuelven en el servidor: la tabla nunca carga el crawl completo en memoria."
      />
      <Suspense fallback={<div className="card text-sm text-muted">Cargando…</div>}>
        <PagesTable crawlId={crawlId} />
      </Suspense>
    </div>
  );
}
