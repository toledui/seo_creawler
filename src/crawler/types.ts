export type CrawlErrorType =
  | 'DNS_ERROR'
  | 'TIMEOUT'
  | 'TLS_ERROR'
  | 'CONNECTION_ERROR'
  | 'INVALID_URL'
  | 'BLOCKED_ROBOTS'
  | 'BLOCKED_HOST'
  | 'TOO_LARGE'
  | 'TOO_MANY_REDIRECTS'
  | 'UNSUPPORTED_CONTENT'
  | 'UNKNOWN';

export type FetchResult = {
  url: string;
  finalUrl: string;
  statusCode: number | null;
  contentType: string | null;
  contentLength: number | null;
  responseTime: number;
  headers: Record<string, string>;
  body: string | null;
  redirectUrl: string | null;
  redirectChain: string[];
  errorType: CrawlErrorType | null;
  errorMessage: string | null;
};

export type ExtractedLink = {
  href: string;
  anchorText: string;
  rel: string | null;
  follow: boolean;
};

export type ExtractedImage = {
  /** URL absoluta del candidato principal (src, data-src o 1.º del srcset). */
  src: string;
  /**
   * Valor del atributo `alt`. `null` = el atributo NO existe (error de
   * accesibilidad); `''` = `alt=""`, imagen decorativa declarada, que es
   * válido y no debe reportarse como "sin alt".
   */
  alt: string | null;
  /** true si el elemento declara el atributo `alt`, aunque esté vacío. */
  hasAlt: boolean;
  width: number | null;
  height: number | null;
  loading: string | null;
  /** `srcset` (o `data-srcset`) sin procesar, tal y como venía en el HTML. */
  srcset: string | null;
  /**
   * Todas las URLs absolutas que puede acabar pidiendo el navegador para
   * esta misma imagen: src + srcset propio + `<source>` del `<picture>`.
   * Son variantes del MISMO elemento, así que no generan incidencias
   * duplicadas de alt.
   */
  candidates: string[];
};

export type ExtractedHeading = {
  level: number;
  text: string;
  order: number;
};

export type ExtractedSchema = {
  schemaType: string | null;
  rawJson: string;
  validJson: boolean;
};

export type ExtractedHreflang = {
  href: string;
  language: string;
};

export type ParsedPage = {
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  language: string | null;
  h1: string | null;
  h1Count: number;
  h2Count: number;
  wordCount: number;
  contentHash: string | null;
  /** Texto visible normalizado; se usa para el simhash, no se persiste. */
  text: string;
  headings: ExtractedHeading[];
  links: ExtractedLink[];
  images: ExtractedImage[];
  schemas: ExtractedSchema[];
  hreflangs: ExtractedHreflang[];
  hasAuthor: boolean;
  publishedDate: string | null;
  modifiedDate: string | null;
  externalCitations: number;
  textRatio: number;
};

export type CrawlConfig = {
  crawlId: string;
  startUrl: string;
  maxUrls: number;
  maxDepth: number;
  concurrency: number;
  delayMs: number;
  respectRobots: boolean;
  followSubdomains: boolean;
  followNofollow: boolean;
  userAgent: string;
  includePatterns: string[];
  excludePatterns: string[];
  useSitemaps: boolean;
};

export type QueueItem = {
  url: string;
  normalizedUrl: string;
  hash: string;
  depth: number;
  discoveredFrom: string | null;
  discoveryType: 'START' | 'LINK' | 'SITEMAP' | 'REDIRECT';
};
