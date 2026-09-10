/**
 * Validación de hreflang (sección 14 del plan).
 *
 * Comprueba lo que realmente rompe la anotación internacional:
 * códigos mal formados, ausencia de auto-referencia, destinos que no
 * responden 200 y falta de reciprocidad entre versiones.
 */

/** Códigos ISO 639-1 más un puñado de tres letras habituales. */
const LANGUAGE_RE = /^[a-z]{2,3}$/;
const REGION_RE = /^[A-Z]{2}$|^[0-9]{3}$/;

export type HreflangEntry = {
  href: string;
  language: string;
};

export type HreflangProblem =
  | { code: 'HREFLANG_INVALID_CODE'; detail: string }
  | { code: 'HREFLANG_MISSING_SELF'; detail: string }
  | { code: 'HREFLANG_BROKEN_TARGET'; detail: string }
  | { code: 'HREFLANG_NOT_RECIPROCAL'; detail: string };

/** `es`, `es-ES`, `zh-Hant-TW` o el especial `x-default`. */
export function isValidHreflangCode(value: string): boolean {
  const code = value.trim();
  if (!code) return false;
  if (code.toLowerCase() === 'x-default') return true;

  const parts = code.split('-');
  if (parts.length > 3) return false;

  if (!LANGUAGE_RE.test(parts[0].toLowerCase())) return false;
  if (parts[0] !== parts[0].toLowerCase()) return false;

  if (parts.length === 1) return true;

  // Con tres partes la del medio es el script (Latn, Hant…).
  if (parts.length === 3) {
    if (!/^[A-Z][a-z]{3}$/.test(parts[1])) return false;
    return REGION_RE.test(parts[2]);
  }

  const second = parts[1];
  if (/^[A-Z][a-z]{3}$/.test(second)) return true; // sólo script
  return REGION_RE.test(second);
}

export type HreflangContext = {
  /** URL normalizada de la página que declara los hreflang. */
  pageUrl: string;
  entries: HreflangEntry[];
  /** Status de cada URL destino conocida en el crawl (normalizada -> status). */
  statusByUrl: Map<string, number | null>;
  /** Hreflang declarados por cada URL destino, para comprobar reciprocidad. */
  entriesByUrl: Map<string, HreflangEntry[]>;
  /** Normalizador (el mismo del crawler) para comparar URLs con criterio. */
  normalize: (url: string) => string | null;
};

export function validateHreflang(context: HreflangContext): HreflangProblem[] {
  const { entries, pageUrl } = context;
  if (entries.length === 0) return [];

  const problems: HreflangProblem[] = [];

  // ---- Códigos mal formados
  const invalid = entries.filter((e) => !isValidHreflangCode(e.language));
  if (invalid.length > 0) {
    problems.push({
      code: 'HREFLANG_INVALID_CODE',
      detail: invalid.map((e) => e.language).join(', '),
    });
  }

  // ---- Auto-referencia
  const normalizedTargets = entries
    .map((e) => context.normalize(e.href))
    .filter((u): u is string => Boolean(u));

  if (!normalizedTargets.includes(pageUrl)) {
    problems.push({
      code: 'HREFLANG_MISSING_SELF',
      detail: 'El conjunto no incluye una etiqueta que apunte a esta misma URL',
    });
  }

  // ---- Destinos rotos (sólo los que el crawl conoce)
  const broken: string[] = [];
  for (const target of normalizedTargets) {
    if (target === pageUrl) continue;
    if (!context.statusByUrl.has(target)) continue;
    const status = context.statusByUrl.get(target);
    if (status == null || status >= 300) {
      broken.push(`${target} (${status ?? 'sin respuesta'})`);
    }
  }
  if (broken.length > 0) {
    problems.push({
      code: 'HREFLANG_BROKEN_TARGET',
      detail: broken.slice(0, 5).join(' · '),
    });
  }

  // ---- Reciprocidad: si A apunta a B, B debe apuntar a A
  const notReciprocal: string[] = [];
  for (const target of normalizedTargets) {
    if (target === pageUrl) continue;
    const targetEntries = context.entriesByUrl.get(target);
    if (!targetEntries || targetEntries.length === 0) continue;

    const pointsBack = targetEntries.some(
      (e) => context.normalize(e.href) === pageUrl,
    );
    if (!pointsBack) notReciprocal.push(target);
  }
  if (notReciprocal.length > 0) {
    problems.push({
      code: 'HREFLANG_NOT_RECIPROCAL',
      detail: notReciprocal.slice(0, 5).join(' · '),
    });
  }

  return problems;
}

export const HREFLANG_RULES = [
  {
    code: 'HREFLANG_INVALID_CODE',
    severity: 'MEDIUM' as const,
    title: 'Código hreflang inválido',
    description:
      'El valor de hreflang no es un código de idioma/región válido (ej. es, es-ES, x-default).',
  },
  {
    code: 'HREFLANG_MISSING_SELF',
    severity: 'MEDIUM' as const,
    title: 'Hreflang sin auto-referencia',
    description:
      'Un conjunto hreflang debe incluir una etiqueta que apunte a la propia URL.',
  },
  {
    code: 'HREFLANG_BROKEN_TARGET',
    severity: 'HIGH' as const,
    title: 'Destino hreflang roto',
    description:
      'Una etiqueta hreflang apunta a una URL que no responde 200.',
  },
  {
    code: 'HREFLANG_NOT_RECIPROCAL',
    severity: 'MEDIUM' as const,
    title: 'Hreflang sin reciprocidad',
    description:
      'La URL destino no devuelve la referencia hreflang hacia esta página.',
  },
];
