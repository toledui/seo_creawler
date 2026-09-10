import { SiloMap } from '@/components/graph/SiloMap';

type Params = { params: Promise<{ crawlId: string }> };

export default async function SilosPage({ params }: Params) {
  const { crawlId } = await params;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Silos</h1>
        <p className="text-sm text-muted">
          Si el enlazado interno refuerza la arquitectura del sitio o la
          deshace.
        </p>
      </div>

      <SiloMap crawlId={crawlId} />
    </div>
  );
}
