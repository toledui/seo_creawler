import { prisma } from '@/lib/prisma';
import { assertProjectOwner, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { getUserAiConfig } from '@/lib/settings';

type Params = { params: Promise<{ projectId: string }> };

/**
 * Informes de IA de todo el proyecto, no sólo de un crawl.
 *
 * La comparación interesante es entre auditorías de fechas distintas, así
 * que el selector necesita ver el histórico completo del proyecto.
 */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectOwner(projectId, user.id);

    const sp = new URL(request.url).searchParams;
    const type = sp.get('type') ?? undefined;

    const reports = await prisma.aiReport.findMany({
      where: {
        crawl: { projectId },
        ...(type ? { type } : {}),
        // Los intentos fallidos se guardan para poder depurar, pero no
        // sirven ni para abrir ni para comparar.
        error: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        model: true,
        type: true,
        createdAt: true,
        output: true,
        crawlId: true,
        crawl: {
          select: {
            startUrl: true,
            crawledUrls: true,
            completedAt: true,
          },
        },
      },
    });

    return ok({
      reports: reports.map((report) => ({
        id: report.id,
        model: report.model,
        type: report.type,
        createdAt: report.createdAt,
        crawlId: report.crawlId,
        crawledUrls: report.crawl.crawledUrls,
        crawlCompletedAt: report.crawl.completedAt,
        // En el listado sólo va el score; el informe entero se pide al abrirlo.
        score:
          (report.output as { score?: number } | null)?.score ?? null,
      })),
      enabled: (await getUserAiConfig(user.id)).configured,
    });
  });
}
