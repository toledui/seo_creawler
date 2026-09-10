import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { accessibleOwnerIds } from '@/lib/access';
import { fail, handle, ok } from '@/lib/api';
import { normalizeUrl } from '@/src/crawler/normalize-url';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  domain: z.string().min(3).max(255),
});

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const projects = await prisma.project.findMany({
      where: { userId: { in: await accessibleOwnerIds(user.id) } },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { crawls: true } } },
    });
    return ok({ projects });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = createSchema.parse(await request.json());

    const withProtocol = /^https?:\/\//i.test(body.domain)
      ? body.domain
      : `https://${body.domain}`;

    const domain = normalizeUrl(withProtocol);
    if (!domain) return fail('El dominio no es una URL http(s) válida', 422);

    const project = await prisma.project.create({
      data: { name: body.name.trim(), domain, userId: user.id },
    });

    return ok({ project }, { status: 201 });
  });
}
