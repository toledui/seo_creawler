/**
 * Parser de `srcset` siguiendo el algoritmo del estándar HTML.
 *
 * No vale con `split(',')`: las URLs de CDN llevan comas en sus parámetros
 * de transformación (`/cdn-cgi/image/w=800,q=75/foto.webp`), así que hay
 * que leer la URL hasta el primer espacio y sólo después buscar la coma
 * que separa candidatos.
 */
export type SrcsetCandidate = {
  url: string;
  /** Descriptor tal cual aparece: `800w`, `2x`, `` si no hay. */
  descriptor: string;
};

export function parseSrcset(value: string | null | undefined): SrcsetCandidate[] {
  if (!value) return [];

  const out: SrcsetCandidate[] = [];
  const s = value;
  let i = 0;
  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

  while (i < s.length) {
    // 1. Saltar espacios y comas sobrantes.
    while (i < s.length && (isWs(s[i]) || s[i] === ',')) i++;
    if (i >= s.length) break;

    // 2. La URL llega hasta el primer espacio.
    const start = i;
    while (i < s.length && !isWs(s[i])) i++;
    let url = s.slice(start, i);

    // 3. Si la URL termina en comas, ahí acaba el candidato (sin descriptor).
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      // 4. Saltar espacios y leer el descriptor hasta la siguiente coma.
      while (i < s.length && isWs(s[i])) i++;
      const dStart = i;
      while (i < s.length && s[i] !== ',') i++;
      descriptor = s.slice(dStart, i).trim();
      if (s[i] === ',') i++;
    }

    if (url) out.push({ url, descriptor });
  }

  return out;
}

/** Sólo las URLs, en orden de aparición y sin repetir. */
export function srcsetUrls(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { url } of parseSrcset(value)) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
