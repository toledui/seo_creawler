import { GraphExplorer } from '@/components/graph/GraphExplorer';
import { SectionTitle } from '@/components/ui';

export default async function GraphPage({
  params,
}: {
  params: Promise<{ crawlId: string }>;
}) {
  const { crawlId } = await params;

  return (
    <div>
      <SectionTitle
        title="Arquitectura del sitio"
        description="El árbol muestra la jerarquía real del sitio; el grafo de fuerzas muestra la maraña completa de enlaces internos."
      />
      <GraphExplorer crawlId={crawlId} />
    </div>
  );
}
