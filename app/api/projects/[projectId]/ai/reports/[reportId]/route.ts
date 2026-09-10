import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';

type Params = { params: Promise<{ projectId: string; reportId: string }> };

/** Contenido completo de un informe guardado. */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId, reportId } = await params;
    await assertProjectOwner(projectId, user.id);

    const report = await prisma.aiReport.findFirst({
      where: { id: reportId, crawl: { projectId } },
      include: {
        crawl: {
          select: { id: true, startUrl: true, crawledUrls: true, completedAt: true },
        },
      },
    });

    if (!report) return fail('Informe no encontrado', 404);

    return ok({ report });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId, reportId } = await params;
    await assertProjectWrite(projectId, user.id);

    const deleted = await prisma.aiReport.deleteMany({
      where: { id: reportId, crawl: { projectId } },
    });

    if (deleted.count === 0) return fail('Informe no encontrado', 404);
    return ok({ success: true });
  });
}
