import { prisma } from '@/lib/prisma';
import { assertProjectOwner, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';

type Params = { params: Promise<{ projectId: string; keywordId: string }> };

/**
 * Fotos del SERP guardadas para una keyword.
 *
 * Consultarlas es gratis: los datos ya se pagaron al medirlos, así que la
 * ficha de competidores se abre las veces que haga falta.
 */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId, keywordId } = await params;
    await assertProjectOwner(projectId, user.id);

    let id: bigint;
    try {
      id = BigInt(keywordId);
    } catch {
      return fail('Identificador inválido', 400);
    }

    const keyword = await prisma.keyword.findFirst({
      where: { id, projectId },
      select: {
        id: true,
        keyword: true,
        serpPosition: true,
        serpPreviousPosition: true,
        serpBestPosition: true,
        serpUrl: true,
        serpCheckedAt: true,
      },
    });

    if (!keyword) return fail('Keyword no encontrada', 404);

    const days = Math.min(
      365,
      Math.max(7, Number(new URL(request.url).searchParams.get('days') ?? 90)),
    );
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    const checks = await prisma.serpCheck.findMany({
      where: { keywordId: id, date: { gte: since } },
      orderBy: { date: 'desc' },
      take: 200,
    });

    const latest = checks[0] ?? null;

    return ok({
      keyword,
      latest: latest
        ? {
            date: latest.date,
            rankAbsolute: latest.rankAbsolute,
            rankGroup: latest.rankGroup,
            url: latest.url,
            found: latest.found,
            featureTypes: latest.featureTypes
              ? latest.featureTypes.split(',').filter(Boolean)
              : [],
            topResults: latest.topResults ?? [],
            totalResults: latest.totalResults,
            device: latest.device,
            locationCode: latest.locationCode,
            languageCode: latest.languageCode,
          }
        : null,
      history: checks
        .slice()
        .reverse()
        .map((check) => ({
          date: check.date,
          position: check.found ? check.rankGroup ?? check.rankAbsolute : null,
          found: check.found,
        })),
    });
  });
}
