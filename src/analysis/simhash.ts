import { createHash } from 'node:crypto';

const HASH_BITS = 64;
const SHINGLE_SIZE = 4;

/** Hash de 64 bits de un token, como BigInt. */
function hash64(token: string): bigint {
  const digest = createHash('md5').update(token).digest();
  return digest.readBigUInt64BE(0);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * SimHash del contenido de una página.
 *
 * A diferencia del hash exacto (`contentHash`), dos textos casi iguales
 * producen simhashes que sólo difieren en unos pocos bits, así que la
 * distancia de Hamming detecta contenido "near-duplicate": fichas de
 * producto clonadas, paginaciones, plantillas con dos frases cambiadas.
 *
 * Se usan shingles de 4 palabras para que reordenar párrafos no baste
 * para esquivar la detección.
 */
export function simhashOf(text: string): string | null {
  const words = tokenize(text);
  if (words.length < SHINGLE_SIZE) return null;

  const vector = new Array<number>(HASH_BITS).fill(0);

  for (let i = 0; i <= words.length - SHINGLE_SIZE; i++) {
    const shingle = words.slice(i, i + SHINGLE_SIZE).join(' ');
    const h = hash64(shingle);
    for (let bit = 0; bit < HASH_BITS; bit++) {
      const isSet = (h >> BigInt(bit)) & 1n;
      vector[bit] += isSet === 1n ? 1 : -1;
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < HASH_BITS; bit++) {
    if (vector[bit] > 0) fingerprint |= 1n << BigInt(bit);
  }

  return fingerprint.toString(16).padStart(16, '0');
}

/** Número de bits distintos entre dos simhashes (0 = idénticos). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let distance = 0;
  while (x > 0n) {
    distance += Number(x & 1n);
    x >>= 1n;
  }
  return distance;
}

/** Dos páginas se consideran casi duplicadas por debajo de este umbral. */
export const NEAR_DUPLICATE_THRESHOLD = 6;

/** Porcentaje de similitud legible a partir de la distancia. */
export function similarityPercent(distance: number): number {
  return Math.round(((HASH_BITS - distance) / HASH_BITS) * 100);
}
