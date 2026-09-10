import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';

type Params = { params: Promise<{ projectId: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  domain: z.string().min(3).max(255).optional(),
});

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectOwner(projectId, user.id);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { crawls: { orderBy: { createdAt: 'desc' } } },
    });

    return ok({ project });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectWrite(projectId, user.id);

    const body = patchSchema.parse(await request.json());
    const project = await prisma.project.update({
      where: { id: projectId },
      data: body,
    });

    return ok({ project });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectWrite(projectId, user.id);

    await prisma.project.delete({ where: { id: projectId } });
    return ok({ success: true });
  });
}
