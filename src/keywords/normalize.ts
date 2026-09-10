/**
 * Normalización de keywords para deduplicar.
 *
 * "Zapatillas  Running", "zapatillas running" y "Zapatillas Running "
 * son la misma consulta. Se conserva el texto original para mostrarlo y
 * se guarda la forma normalizada como clave única.
 */
export function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Códigos de país que acepta Search Console (ISO 3166-1 alfa-3). */
export function normalizeCountry(value: string | null | undefined): string {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return 'esp';

  // Aceptamos alfa-2 comunes y los traducimos a alfa-3.
  const alpha2: Record<string, string> = {
    es: 'esp',
    mx: 'mex',
    ar: 'arg',
    co: 'col',
    cl: 'chl',
    pe: 'per',
    us: 'usa',
    gb: 'gbr',
    uk: 'gbr',
    fr: 'fra',
    de: 'deu',
    it: 'ita',
    pt: 'prt',
    br: 'bra',
  };

  if (raw.length === 2) return alpha2[raw] ?? 'esp';
  if (raw.length === 3) return raw;
  return 'esp';
}

export type Device = 'ALL' | 'DESKTOP' | 'MOBILE' | 'TABLET';

export function normalizeDevice(value: string | null | undefined): Device {
  const raw = (value ?? '').trim().toUpperCase();
  if (raw === 'DESKTOP' || raw === 'ESCRITORIO') return 'DESKTOP';
  if (raw === 'MOBILE' || raw === 'MÓVIL' || raw === 'MOVIL') return 'MOBILE';
  if (raw === 'TABLET' || raw === 'TABLETA') return 'TABLET';
  return 'ALL';
}

export const KEYWORD_MAX_LENGTH = 255;

export function isValidKeyword(keyword: string): boolean {
  const normalized = normalizeKeyword(keyword);
  return normalized.length > 0 && normalized.length <= KEYWORD_MAX_LENGTH;
}
