import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { importKeywordsCsv } from '@/src/keywords/csv-import';

type Params = { params: Promise<{ projectId: string }> };

export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;

/** Historial de importaciones del proyecto. */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectOwner(projectId, user.id);

    const imports = await prisma.keywordImport.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return ok({ imports });
  });
}

/**
 * Importa un CSV de keywords.
 *
 * Acepta tanto `multipart/form-data` con un archivo como texto plano en
 * el cuerpo, para poder pegar una lista directamente.
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectWrite(projectId, user.id);

    const contentType = request.headers.get('content-type') ?? '';
    let content: string;
    let filename: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');

      if (!(file instanceof File)) {
        return fail('No se recibió ningún archivo', 422);
      }
      if (file.size > MAX_BYTES) {
        return fail('El archivo supera los 20 MB', 413);
      }

      content = await file.text();
      filename = file.name;
    } else {
      content = await request.text();
      if (content.length > MAX_BYTES) {
        return fail('El contenido supera los 20 MB', 413);
      }
    }

    if (!content.trim()) return fail('El contenido está vacío', 422);

    const result = await importKeywordsCsv(projectId, content, filename);
    return ok({ result });
  });
}
