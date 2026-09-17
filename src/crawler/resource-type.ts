/**
 * Clasificación de recursos.
 *
 * El auditor rastrea cualquier URL que encuentre (enlaces directos a un
 * PDF, a un JPG de /wp-content/uploads/, a una hoja de estilos…), pero las
 * reglas SEO de metadatos sólo tienen sentido sobre documentos HTML. Este
 * módulo decide, a partir de la respuesta HTTP final, qué es cada URL para
 * que el resto del pipeline no trate un WebP como si fuera una página.
 *
 * Señal principal: la cabecera `Content-Type` normalizada (sin parámetros).
 * Señal secundaria: la extensión del path, usada SÓLO cuando la cabecera
 * falta, es genérica (`application/octet-stream`) o no es un MIME válido.
 */

/** Categorías públicas de recurso. */
export type ResourceType =
  | 'HTML_PAGE'
  | 'IMAGE'
  | 'CSS'
  | 'JAVASCRIPT'
  | 'FONT'
  | 'PDF'
  | 'OTHER_ASSET'
  | 'REDIRECT'
  | 'ERROR'
  | 'UNKNOWN';

/**
 * Qué son los bytes del recurso, independientemente del status HTTP.
 * `REDIRECT` y `ERROR` describen la respuesta, no el contenido, así que
 * no forman parte de este subconjunto.
 */
export type MediaType = Exclude<ResourceType, 'REDIRECT' | 'ERROR'>;

export const RESOURCE_TYPES: ResourceType[] = [
  'HTML_PAGE',
  'IMAGE',
  'CSS',
  'JAVASCRIPT',
  'FONT',
  'PDF',
  'OTHER_ASSET',
  'REDIRECT',
  'ERROR',
  'UNKNOWN',
];

/** Tipos que no aportan información: hay que mirar la extensión. */
const GENERIC_MIMES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/binary',
  'application/unknown',
  'application/force-download',
  'application/download',
  'application/x-download',
  'text/plain',
  'unknown/unknown',
  '*/*',
]);

const HTML_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/xhtml',
  'text/xhtml',
  'application/vnd.wap.xhtml+xml',
]);

const JS_MIMES = new Set([
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/node',
  'module',
]);

const FONT_MIMES = new Set([
  'application/font-woff',
  'application/font-woff2',
  'application/x-font-woff',
  'application/x-font-ttf',
  'application/x-font-truetype',
  'application/x-font-opentype',
  'application/x-font-otf',
  'application/font-sfnt',
  'application/vnd.ms-fontobject',
]);

const EXTENSION_MIME: Record<string, string> = {
  // HTML
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
  // Imágenes
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  apng: 'image/apng',
  // Estilos y scripts
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  // Fuentes
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  // Documentos
  pdf: 'application/pdf',
  // Otros assets habituales
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  gz: 'application/gzip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
};

/**
 * Deja el MIME en minúsculas y sin parámetros.
 * `text/html; charset=UTF-8` → `text/html`.
 * Devuelve `null` si no tiene forma de `tipo/subtipo`.
 */
export function normalizeContentType(
  contentType: string | null | undefined,
): string | null {
  if (!contentType) return null;
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime) return null;
  // `module` y `*/*` son valores reales que devuelven algunos servidores.
  if (mime === 'module' || mime === '*/*') return mime;
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)) {
    return null;
  }
  return mime;
}

/** true si el MIME no aporta información y toca mirar la extensión. */
export function isGenericMime(mime: string | null): boolean {
  return mime == null || GENERIC_MIMES.has(mime);
}

/** Categoría de contenido a partir de un MIME ya normalizado. */
export function mediaTypeFromMime(mime: string | null): MediaType | null {
  if (mime == null || GENERIC_MIMES.has(mime)) return null;
  if (HTML_MIMES.has(mime)) return 'HTML_PAGE';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime === 'text/css') return 'CSS';
  if (JS_MIMES.has(mime)) return 'JAVASCRIPT';
  if (mime.startsWith('font/') || FONT_MIMES.has(mime)) return 'FONT';
  if (mime === 'application/pdf') return 'PDF';
  return 'OTHER_ASSET';
}

/** Extensión del path de una URL, en minúsculas y sin punto. */
export function extensionOf(url: string): string | null {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // URL relativa o inválida: nos quedamos con el path aproximado.
    pathname = url.split('#')[0].split('?')[0];
  }
  const last = pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) return null;
  const ext = last.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
}

/** MIME canónico que cabría esperar por la extensión de la URL. */
export function mimeFromExtension(url: string): string | null {
  const ext = extensionOf(url);
  if (!ext) return null;
  return EXTENSION_MIME[ext] ?? null;
}

/** Categoría de contenido deducida sólo de la extensión. */
export function mediaTypeFromExtension(url: string): MediaType | null {
  const mime = mimeFromExtension(url);
  if (!mime) return null;
  // `text/plain` es genérico como cabecera, pero como extensión (.txt) sí
  // identifica un asset.
  if (mime === 'text/plain') return 'OTHER_ASSET';
  return mediaTypeFromMime(mime);
}

export type ClassifyInput = {
  /** URL solicitada. */
  url: string;
  /** URL tras seguir las redirecciones, si la hay. */
  finalUrl?: string | null;
  /** Status de la respuesta registrada (3xx si la fila es la redirección). */
  statusCode: number | null;
  /** Cabecera Content-Type cruda de la respuesta final. */
  contentType: string | null;
  /** Error de red/robots, si lo hubo. */
  errorType?: string | null;
  /** Saltos de redirección seguidos. */
  redirectChain?: string[] | null;
};

export type ResourceClassification = {
  /** Clasificación pública de la fila tal y como se rastreó. */
  resourceType: ResourceType;
  /**
   * Clasificación del recurso final ignorando el 3xx intermedio: una
   * redirección que acaba en HTML da `HTML_PAGE`, una que acaba en una
   * imagen da `IMAGE`, y una imagen que responde 404 da `ERROR`.
   */
  finalResourceType: ResourceType;
  /** Qué son los bytes, al margen del status. */
  mediaType: MediaType;
  /** MIME normalizado (sin parámetros) o null si no había cabecera válida. */
  mimeType: string | null;
  /** De dónde salió la clasificación de contenido. */
  mimeSource: 'header' | 'extension' | 'none';
  /** La extensión promete un MIME y el servidor devuelve otro distinto. */
  extensionMismatch: boolean;
  /** MIME esperado por la extensión, cuando se conoce. */
  expectedMime: string | null;
  /** Atajo: ¿se puede parsear como DOM HTML? */
  isHtmlDocument: boolean;
  /** Atajo: ¿la respuesta pasó por una redirección? */
  redirected: boolean;
};

/** Errores que no impiden considerar el recurso "entregado". */
const SOFT_ERRORS = new Set(['UNSUPPORTED_CONTENT']);

/**
 * Clasifica una URL a partir de su respuesta HTTP final.
 *
 * Prioridad: error de red > status HTTP > Content-Type > extensión.
 */
export function classifyResource(input: ClassifyInput): ResourceClassification {
  const mimeType = normalizeContentType(input.contentType);
  const target = input.finalUrl || input.url;

  const fromMime = mediaTypeFromMime(mimeType);
  const fromExtension =
    mediaTypeFromExtension(target) ?? mediaTypeFromExtension(input.url);

  const hardError = Boolean(input.errorType && !SOFT_ERRORS.has(input.errorType));
  const status = input.statusCode;
  const failed = hardError || status == null || status >= 400;

  // En una respuesta de error el Content-Type describe la PÁGINA DE ERROR
  // (WordPress sirve su 404 en text/html aunque se pidiera un .webp), no el
  // recurso solicitado. Ahí manda la extensión: es lo que permite decir
  // "esta imagen está rota" en vez de "esta página no tiene title".
  const preferExtension = failed && fromExtension != null;

  const mediaType: MediaType = preferExtension
    ? fromExtension
    : (fromMime ?? fromExtension ?? 'UNKNOWN');
  const mimeSource: ResourceClassification['mimeSource'] = preferExtension
    ? 'extension'
    : fromMime
      ? 'header'
      : fromExtension
        ? 'extension'
        : 'none';

  const expectedMime = mimeFromExtension(target) ?? mimeFromExtension(input.url);
  const extensionMismatch = Boolean(
    expectedMime && mimeType && !isGenericMime(mimeType) && expectedMime !== mimeType,
  );

  const redirected =
    (input.redirectChain?.length ?? 0) > 0 ||
    (status != null && status >= 300 && status < 400);

  let resourceType: ResourceType;
  if (failed) {
    resourceType = 'ERROR';
  } else if (status != null && status >= 300) {
    resourceType = 'REDIRECT';
  } else {
    resourceType = mediaType;
  }

  const finalResourceType: ResourceType = failed ? 'ERROR' : mediaType;

  return {
    resourceType,
    finalResourceType,
    mediaType,
    mimeType,
    mimeSource,
    extensionMismatch,
    expectedMime,
    isHtmlDocument: resourceType === 'HTML_PAGE',
    redirected,
  };
}

/**
 * ¿Se le pueden aplicar las reglas SEO exclusivas de documentos HTML?
 *
 * Acepta un valor nulo para no romper crawls anteriores a este campo: en
 * ese caso se recurre al Content-Type guardado.
 */
export function isHtmlPageResource(
  resourceType: string | null | undefined,
  contentType?: string | null,
): boolean {
  if (resourceType) return resourceType === 'HTML_PAGE';
  return mediaTypeFromMime(normalizeContentType(contentType ?? null)) === 'HTML_PAGE';
}

/** true si la categoría describe un asset (no una página ni un estado). */
export function isAssetResource(resourceType: string | null | undefined): boolean {
  return (
    resourceType === 'IMAGE' ||
    resourceType === 'CSS' ||
    resourceType === 'JAVASCRIPT' ||
    resourceType === 'FONT' ||
    resourceType === 'PDF' ||
    resourceType === 'OTHER_ASSET'
  );
}
