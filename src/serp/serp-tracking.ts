import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import {
  SERP_COST_USD,
  SerplifyError,
  SerplifyNotConfiguredError,
  normalizeTarget,
  serpSearch,
  serplifyConfig,
  type SerpItem,
  type SerplifyConfig,
} from './serplify-client';

/**
 * Medición de posiciones reales con Serplify.
 *
 * Complementa a Search Console, no lo sustituye: GSC dice cuántos clics e
 * impresiones tienes y su posición media del periodo; Serplify dice en qué
 * puesto exacto sale hoy la URL y quién está por encima, también para
 * keywords donde todavía no apareces (que GSC nunca muestra).
 */

/** Pausa entre consultas: son de pago y no conviene ráfagas. */
export const SERP_DELAY_MS = Number(process.env.SERP_DELAY_MS ?? 400);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Dominio a seguir: el configurado o, si no, el del proyecto. */
export function targetFor(project: {
  domain: string;
  serpTarget: string | null;
}): string {
  return normalizeTarget(project.serpTarget || project.domain);
}

/** Top orgánico, para ver quién ocupa los puestos de cabeza. */
function topOrganic(items: SerpItem[], limit = 10) {
  return items
    .filter((item) => item.type === 'organic')
    .slice(0, limit)
    .map((item) => ({
      rank: item.rank_group ?? item.rank_absolute ?? null,
      domain: item.domain ?? null,
      url: item.url ?? null,
      title: item.title ?? null,
    }));
}

export type SerpCheckResult = {
  keywordId: bigint;
  keyword: string;
  found: boolean;
  rankAbsolute: number | null;
  rankGroup: number | null;
  url: string | null;
  cost: number;
};

/**
 * Mide una keyword y guarda la foto del SERP.
 *
 * Es idempotente por día: si ya se midió hoy se sobrescribe en lugar de
 * volver a cobrar otra fila.
 */
export async function checkKeyword(
  keywordId: bigint,
  options: { config?: SerplifyConfig; date?: Date } = {},
): Promise<SerpCheckResult> {
  const keyword = await prisma.keyword.findUnique({
    where: { id: keywordId },
    include: {
      project: {
        select: {
          name: true,
          domain: true,
          serpTarget: true,
          serpLocationCode: true,
          serpLanguageCode: true,
          serpDevice: true,
        },
      },
    },
  });

  if (!keyword) throw new Error('Keyword no encontrada');

  const project = keyword.project;
  const target = targetFor(project);

  const result = await serpSearch({
    keyword: keyword.keyword,
    locationCode: project.serpLocationCode,
    languageCode: project.serpLanguageCode,
    device: project.serpDevice === 'mobile' ? 'mobile' : 'desktop',
    target,
    label: project.name,
    config: options.config,
  });

  const { data } = result;
  const tracked = data.tracked_rank;

  const day = startOfUtcDay(options.date ?? new Date());

  const payload = {
    locationCode: project.serpLocationCode,
    languageCode: project.serpLanguageCode,
    device: project.serpDevice,
    rankAbsolute: tracked?.rank_absolute ?? null,
    rankGroup: tracked?.rank_group ?? null,
    url: tracked?.url ?? null,
    found: Boolean(tracked?.found),
    featureTypes: (data.feature_types ?? []).join(','),
    topResults: topOrganic(data.items ?? []) as unknown as Prisma.InputJsonValue,
    totalResults: data.total_results_count
      ? BigInt(Math.trunc(data.total_results_count))
      : null,
    costUsd: result.cost,
    requestId: result.requestId,
  };

  await prisma.serpCheck.upsert({
    where: { keywordId_date: { keywordId, date: day } },
    create: { keywordId, date: day, ...payload },
    update: payload,
  });

  // La posición que se muestra es la del bloque orgánico: es la que la
  // gente entiende por "estoy el tercero".
  const position = tracked?.found ? tracked.rank_group ?? tracked.rank_absolute : null;

  await prisma.keyword.update({
    where: { id: keywordId },
    data: {
      serpPreviousPosition: keyword.serpPosition,
      serpPosition: position,
      serpBestPosition:
        position == null
          ? keyword.serpBestPosition
          : keyword.serpBestPosition == null
            ? position
            : Math.min(keyword.serpBestPosition, position),
      serpUrl: tracked?.url ?? null,
      serpCheckedAt: new Date(),
    },
  });

  return {
    keywordId,
    keyword: keyword.keyword,
    found: Boolean(tracked?.found),
    rankAbsolute: tracked?.rank_absolute ?? null,
    rankGroup: tracked?.rank_group ?? null,
    url: tracked?.url ?? null,
    cost: result.cost,
  };
}

export type BatchResult = {
  checked: number;
  found: number;
  failed: number;
  costUsd: number;
  outOfBalance: boolean;
  errors: string[];
};

/**
 * Mide varias keywords en serie, con pausa entre consultas.
 *
 * Se para en seco si el saldo se agota: seguir intentando sólo generaría
 * errores y ruido en el log.
 */
export async function checkKeywords(
  keywordIds: bigint[],
  options: { date?: Date; onProgress?: (done: number) => Promise<void> } = {},
): Promise<BatchResult> {
  const config = await serplifyConfig();
  if (!config) throw new SerplifyNotConfiguredError();

  const result: BatchResult = {
    checked: 0,
    found: 0,
    failed: 0,
    costUsd: 0,
    outOfBalance: false,
    errors: [],
  };

  for (const keywordId of keywordIds) {
    try {
      const check = await checkKeyword(keywordId, { config, date: options.date });
      result.checked++;
      result.costUsd += check.cost;
      if (check.found) result.found++;
    } catch (err) {
      result.failed++;

      if (err instanceof SerplifyError && err.isOutOfBalance) {
        result.outOfBalance = true;
        result.errors.push('Saldo de Serplify agotado: se detuvo la medición');
        break;
      }

      const message = err instanceof Error ? err.message : String(err);
      if (result.errors.length < 5) result.errors.push(message);
      logger.warn({ event: 'serp_check_failed', keywordId: String(keywordId), err: message });
    }

    await options.onProgress?.(result.checked + result.failed);
    if (SERP_DELAY_MS > 0) await sleep(SERP_DELAY_MS);
  }

  return result;
}

/** Keywords de un proyecto que entran en la medición diaria. */
export async function trackableKeywordIds(projectId: string): Promise<bigint[]> {
  const rows = await prisma.keyword.findMany({
    where: { projectId, tracked: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => row.id);
}

/** Coste estimado de medir un número de keywords. */
export function estimateCost(count: number): number {
  return Number((count * SERP_COST_USD).toFixed(3));
}

/** Gasto real acumulado en un proyecto. */
export async function projectSpend(projectId: string, days = 30) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const result = await prisma.serpCheck.aggregate({
    where: { keyword: { projectId }, date: { gte: startOfUtcDay(since) } },
    _sum: { costUsd: true },
    _count: { _all: true },
  });

  return {
    days,
    checks: result._count._all,
    costUsd: Number((result._sum.costUsd ?? 0).toFixed(3)),
  };
}
