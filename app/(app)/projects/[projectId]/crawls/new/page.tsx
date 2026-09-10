import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { NewCrawlForm } from './NewCrawlForm';

export default async function NewCrawlPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: { in: ownerIds } },
  });

  if (!project) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/projects/${project.id}`} className="link text-sm">
        ← {project.name}
      </Link>
      <NewCrawlForm projectId={project.id} defaultUrl={project.domain} />
    </div>
  );
}
