import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';

type Params = { params: Promise<{ projectId: string; keywordId: string }> };

const patchSchema = z.object({
  tracked: z.boolean().optional(),
  tags: z.string().max(255).nullable().optional(),
  targetUrl: z.string().max(2000).nullable().optional(),
});

function parseId(raw: string): bigint | null {
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** Detalle de la keyword con su histórico diario. */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId, keywordId } = await params;
    await assertProjectOwner(projectId, user.id);

    const id = parseId(keywordId);
    if (id == null) return fail('Identificador inválido', 400);

    const days = Math.min(
      365,
      Math.max(7, Number(new URL(request.url).searchParams.get('days') ?? 90)),
    );

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    const keyword = await prisma.keyword.findFirst({
      where: { id, projectId },
      include: {
        rankings: {
          where: { date: { gte: since } },
          orderBy: { date: 'asc' },
        },
      },
    });

    if (!keyword) return fail('Keyword no encontrada', 404);

    return ok({ keyword });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId, keywordId } = await params;
    await assertProjectWrite(projectId, user.id);

    const id = parseId(keywordId);
    if (id == null) return fail('Identificador inválido', 400);

    const existing = await prisma.keyword.findFirst({
      where: { id, projectId },
      select: { id: true },
    });
    if (!existing) return fail('Keyword no encontrada', 404);

    const body = patchSchema.parse(await request.json());
    const keyword = await prisma.keyword.update({ where: { id }, data: body });

    return ok({ keyword });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId, keywordId } = await params;
    await assertProjectWrite(projectId, user.id);

    const id = parseId(keywordId);
    if (id == null) return fail('Identificador inválido', 400);

    const deleted = await prisma.keyword.deleteMany({ where: { id, projectId } });
    if (deleted.count === 0) return fail('Keyword no encontrada', 404);

    return ok({ success: true });
  });
}
