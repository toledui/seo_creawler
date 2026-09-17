/**
 * Semántica del atributo `alt`, en un único sitio.
 *
 * Los tres estados NO deben mezclarse nunca:
 *   MISSING     → no existe el atributo. Es el error de accesibilidad.
 *   DECORATIVE  → `alt=""`. Forma correcta de declarar una imagen
 *                 decorativa; se informa, no se penaliza.
 *   DESCRIPTIVE → `alt` con texto. Correcto.
 *
 * Una imagen usada sólo como `background-image` en CSS no tiene elemento
 * `<img>` y por tanto no tiene alt: no aparece aquí y nunca se reporta
 * como "sin alt".
 */
export type AltState = 'MISSING' | 'DECORATIVE' | 'DESCRIPTIVE';

export function altState(image: {
  hasAlt: boolean;
  alt: string | null;
}): AltState {
  if (!image.hasAlt) return 'MISSING';
  return (image.alt ?? '').trim() === '' ? 'DECORATIVE' : 'DESCRIPTIVE';
}

export type ImageAuditSummary = {
  elements: number;
  missingAlt: number;
  decorativeAlt: number;
  describedAlt: number;
  pagesWithMissingAlt: number;
  missingAltRatio: number;
};

/**
 * Resume una colección de elementos `<img>` con su página de origen.
 *
 * El denominador de `missingAltRatio` son los elementos `<img>` auditados,
 * nunca las páginas ni los archivos de imagen solicitados.
 */
export function summarizeImageElements(
  elements: { hasAlt: boolean; alt: string | null; pageKey: string }[],
): ImageAuditSummary {
  let missingAlt = 0;
  let decorativeAlt = 0;
  let describedAlt = 0;
  const pagesWithMissing = new Set<string>();

  for (const element of elements) {
    switch (altState(element)) {
      case 'MISSING':
        missingAlt++;
        pagesWithMissing.add(element.pageKey);
        break;
      case 'DECORATIVE':
        decorativeAlt++;
        break;
      default:
        describedAlt++;
    }
  }

  return {
    elements: elements.length,
    missingAlt,
    decorativeAlt,
    describedAlt,
    pagesWithMissingAlt: pagesWithMissing.size,
    missingAltRatio:
      elements.length > 0 ? Number((missingAlt / elements.length).toFixed(4)) : 0,
  };
}
