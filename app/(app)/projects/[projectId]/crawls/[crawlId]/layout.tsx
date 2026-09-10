import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { CrawlTabs } from '@/components/crawl/CrawlTabs';
import { CrawlControls } from '@/components/crawl/CrawlControls';
import { CrawlStatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CrawlLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string; crawlId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId, crawlId } = await params;

  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, projectId, project: { userId: { in: ownerIds } } },
    include: { project: true },
  });

  if (!crawl) notFound();

  const base = `/projects/${projectId}/crawls/${crawlId}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/projects/${projectId}`} className="link text-sm">
            ← {crawl.project.name}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span className="truncate">{crawl.startUrl}</span>
            <CrawlStatusBadge status={crawl.status} />
          </h1>
        </div>
        <CrawlControls crawlId={crawlId} status={crawl.status} />
      </div>

      <CrawlTabs base={base} projectId={projectId} />

      {crawl.errorMessage && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {crawl.errorMessage}
        </p>
      )}

      {children}
    </div>
  );
}
