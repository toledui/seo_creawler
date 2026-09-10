import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { prisma, serialize } from '@/lib/prisma';
import { aiEnabled } from '@/lib/env';
import { AiAudit } from '@/components/ai/AiAudit';
import { AiCompare } from '@/components/ai/AiCompare';
import { AiChat } from '@/components/ai/AiChat';
import { EmptyState, SectionTitle } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AiPage({
  params,
}: {
  params: Promise<{ projectId: string; crawlId: string }>;
}) {
  const user = await requireUser();
  const ownerIds = await accessibleOwnerIds(user.id);
  const { projectId, crawlId } = await params;

  const crawl = await prisma.crawl.findFirst({
    where: { id: crawlId, project: { userId: { in: ownerIds } } },
    select: { crawledUrls: true, stats: true },
  });
  if (!crawl) notFound();

  const reports = await prisma.aiReport.findMany({
    where: { crawlId, type: 'audit' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      model: true,
      createdAt: true,
      output: true,
      error: true,
    },
  });

  if (crawl.crawledUrls === 0) {
    return (
      <EmptyState
        title="Todavía no hay datos que auditar"
        description="Lanza y termina un crawl para poder generar la auditoría con IA."
      />
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="AI Audit"
        description="Informe estructurado generado a partir de los datos reales del crawl."
      />

      <AiAudit
        projectId={projectId}
        crawlId={crawlId}
        enabled={aiEnabled()}
        initialReports={serialize(reports) as never}
      />

      <AiCompare projectId={projectId} enabled={aiEnabled()} />

      <AiChat crawlId={crawlId} enabled={aiEnabled()} />
    </div>
  );
}
