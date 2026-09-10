import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { SectionTitle } from '@/components/ui';
import { KeywordsWorkspace } from '@/components/keywords/KeywordsWorkspace';

export const dynamic = 'force-dynamic';

export default async function KeywordsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: { in: ownerIds } },
    select: { id: true, name: true, domain: true },
  });

  if (!project) notFound();

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Keywords"
        description={`Posiciones reales de ${project.domain} tomadas de Search Console, con seguimiento diario.`}
      />
      <KeywordsWorkspace projectId={project.id} projectDomain={project.domain} />
    </div>
  );
}
