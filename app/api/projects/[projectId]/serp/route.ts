import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertProjectOwner, assertProjectWrite, requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/api';
import { getAppSettings } from '@/lib/settings';
import {
  SerplifyError,
  SerplifyNotConfiguredError,
  serpLanguages,
  serpLocations,
} from '@/src/serp/serplify-client';
import {
  checkKeywords,
  estimateCost,
  projectSpend,
  targetFor,
  trackableKeywordIds,
} from '@/src/serp/serp-tracking';

type Params = { params: Promise<{ projectId: string }> };

export const maxDuration = 300;

const patchSchema = z.object({
  serpTrackingEnabled: z.boolean().optional(),
  serpLocationCode: z.number().int().optional(),
  serpLanguageCode: z.string().max(8).optional(),
  serpDevice: z.enum(['desktop', 'mobile']).optional(),
  serpTarget: z.string().max(255).nullable().optional(),
  serpCountry: z.string().length(2).optional(),
});

const actionSchema = z.object({
  action: z.literal('check-now'),
  /** Sin ids se miden todas las keywords en seguimiento. */
  keywordIds: z.array(z.string()).max(500).optional(),
});

/** Configuración SERP del proyecto, coste estimado y gasto real. */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    const project = await assertProjectOwner(projectId, user.id);

    const query = new URL(request.url).searchParams;

    // El listado global viene recortado y lleno de códigos postales, así
    // que las ubicaciones se piden por país.
    const country = (query.get('country') || project.serpCountry).toUpperCase();

    // Cargar ubicaciones e idiomas son dos llamadas a Serplify: un par de
    // segundos, o veinte si va lento. El panel no debe esperarlas para
    // pintarse, así que sólo se piden al abrir los ajustes.
    const wantsReferences =
      query.get('refs') === '1' || query.has('country');

    const settings = await getAppSettings();
    const available = settings.serplify.configured && settings.serplify.enabled;

    const [trackedCount, spend] = await Promise.all([
      prisma.keyword.count({ where: { projectId, tracked: true } }),
      projectSpend(projectId, 30),
    ]);

    // Las referencias son gratuitas, pero si la clave falla no debe
    // tumbar la pantalla de ajustes.
    let locations: { code: number; name: string }[] = [];
    let languages: { code: string; name: string }[] = [];
    let referenceError: string | null = null;

    if (available && wantsReferences) {
      try {
        const [rawLocations, rawLanguages] = await Promise.all([
          serpLocations(country),
          serpLanguages(),
        ]);

        languages = rawLanguages;

        // Las entradas sin coma son el país entero; van primero porque
        // es lo que quiere casi todo el mundo.
        locations = [...rawLocations].sort((a, b) => {
          const aCountry = !a.name.includes(',');
          const bCountry = !b.name.includes(',');
          if (aCountry !== bCountry) return aCountry ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } catch (err) {
        referenceError = err instanceof Error ? err.message : String(err);
      }
    }

    return ok({
      available,
      configured: settings.serplify.configured,
      enabled: settings.serplify.enabled,
      settings: {
        serpTrackingEnabled: project.serpTrackingEnabled,
        serpLocationCode: project.serpLocationCode,
        serpLanguageCode: project.serpLanguageCode,
        serpDevice: project.serpDevice,
        serpCountry: project.serpCountry,
        serpTarget: project.serpTarget,
        resolvedTarget: targetFor(project),
      },
      trackedCount,
      costPerCheck: 0.005,
      estimatedDailyCost: estimateCost(trackedCount),
      estimatedMonthlyCost: Number((estimateCost(trackedCount) * 30).toFixed(2)),
      spend,
      country,
      // Recortadas: un país como México trae 15.000 entradas.
      locations: locations.slice(0, 300),
      locationsTotal: locations.length,
      languages,
      referenceError,
    });
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
      data: {
        ...(body.serpTrackingEnabled !== undefined
          ? { serpTrackingEnabled: body.serpTrackingEnabled }
          : {}),
        ...(body.serpLocationCode !== undefined
          ? { serpLocationCode: body.serpLocationCode }
          : {}),
        ...(body.serpLanguageCode !== undefined
          ? { serpLanguageCode: body.serpLanguageCode }
          : {}),
        ...(body.serpDevice !== undefined ? { serpDevice: body.serpDevice } : {}),
        ...(body.serpCountry !== undefined
          ? { serpCountry: body.serpCountry.toUpperCase() }
          : {}),
        ...(body.serpTarget !== undefined
          ? { serpTarget: body.serpTarget || null }
          : {}),
      },
    });

    return ok({
      settings: {
        serpTrackingEnabled: project.serpTrackingEnabled,
        serpLocationCode: project.serpLocationCode,
        serpLanguageCode: project.serpLanguageCode,
        serpDevice: project.serpDevice,
        serpCountry: project.serpCountry,
        serpTarget: project.serpTarget,
        resolvedTarget: targetFor(project),
      },
    });
  });
}

/** Medición inmediata: cuesta dinero, así que exige permiso de escritura. */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { projectId } = await params;
    await assertProjectWrite(projectId, user.id);

    const body = actionSchema.parse(await request.json());
    const settings = await getAppSettings();

    if (!settings.serplify.configured) {
      return fail(
        'Serplify no está configurado. Pídeselo al administrador.',
        409,
      );
    }
    if (!settings.serplify.enabled) {
      return fail('Serplify está desactivado en la configuración global.', 409);
    }

    let keywordIds: bigint[];

    if (body.keywordIds?.length) {
      const rows = await prisma.keyword.findMany({
        where: {
          projectId,
          id: { in: body.keywordIds.map((id) => BigInt(id)) },
        },
        select: { id: true },
      });
      keywordIds = rows.map((row) => row.id);
    } else {
      keywordIds = await trackableKeywordIds(projectId);
    }

    if (keywordIds.length === 0) {
      return fail('No hay keywords en seguimiento que medir', 409);
    }

    try {
      const result = await checkKeywords(keywordIds);
      return ok({ result });
    } catch (err) {
      if (err instanceof SerplifyNotConfiguredError) return fail(err.message, 409);
      if (err instanceof SerplifyError) {
        return fail(
          err.isOutOfBalance
            ? 'Saldo de Serplify agotado. Recarga para seguir midiendo.'
            : `Serplify: ${err.message}`,
          err.isOutOfBalance ? 402 : 502,
        );
      }
      throw err;
    }
  });
}
