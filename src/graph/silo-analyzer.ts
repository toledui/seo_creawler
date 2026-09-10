import { prisma } from '../../lib/prisma';

/**
 * Análisis de silos.
 *
 * No confundir con los clusters de la vista de grafo: aquellos son
 * comunidades que Louvain **descubre** a partir del enlazado real, y por eso
 * pueden salir mezclados o con nombres que no significan nada para quien
 * diseñó el sitio.
 *
 * Un silo es lo contrario: la sección que **tú decidiste** que existiera,
 * tomada de la ruta de la URL (`/servicios/...`, `/blog/...`). Lo que
 * interesa aquí no es descubrir grupos sino comprobar si el enlazado
 * respeta esa arquitectura: si cada sección se sostiene por dentro, si su
 * página cabecera recibe fuerza y por dónde se escapa hacia otras.
 */

/** Cuántos segmentos de ruta definen un silo. `/servicios/seo` con 2. */
export type SiloDepth = 1 | 2;

/**
 * Cómo se agrupan las páginas en silos.
 *
 * - `path`: por carpeta de la URL. Es lo correcto cuando el sitio tiene una
 *   jerarquía real (`/servicios/seo/`).
 * - `slug`: por la primera palabra con contenido del slug. Muchos
 *   WordPress publican todo en la raíz (`/diseno-de-paginas-web/`,
 *   `/diseno-de-plataformas-elearning/`), y por carpeta saldría un único
 *   silo inútil; por slug aflora el agrupamiento temático que sí existe.
 */
export type SiloGrouping = 'path' | 'slug';

/**
 * Palabras que no distinguen un tema. Sin quitarlas, medio sitio acabaría
 * en un silo llamado «de».
 */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'a', 'al', 'en',
  'con', 'para', 'por', 'un', 'una', 'unos', 'unas', 'que', 'sin', 'sobre',
  'the', 'of', 'and', 'for', 'to', 'in', 'on', 'with', 'best', 'mejor',
]);

export type SiloPage = {
  pageId: string;
  url: string;
  path: string;
  title: string | null;
  status: number | null;
  depth: number;
  inlinks: number;
  outlinks: number;
  pagerank: number;
  indexable: boolean;
  /** Es la portada de la sección (`/servicios/`). */
  isHub: boolean;
};

export type Silo = {
  key: string;
  label: string;
  pages: number;
  indexablePages: number;
  /** Páginas sin un solo enlace interno entrante. */
  orphans: number;
  avgDepth: number;
  /** Suma del PageRank interno: cuánta fuerza acumula la sección. */
  pagerank: number;
  pagerankShare: number;
  /** Enlaces cuyo origen y destino están en el mismo silo. */
  internalLinks: number;
  /** Enlaces que salen hacia otras secciones. */
  outboundLinks: number;
  /** Enlaces que entran desde otras secciones. */
  inboundLinks: number;
  /**
   * Qué proporción del enlazado saliente se queda dentro. Es la medida de
   * si la sección funciona como silo o si reparte fuerza a todas partes.
   */
  cohesion: number;
  hub: SiloPage | null;
  topPages: SiloPage[];
};

export type SiloFlow = { from: string; to: string; links: number };

export type SiloFinding = {
  code: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  silo: string | null;
  title: string;
  detail: string;
};

export type SiloReport = {
  depth: SiloDepth;
  grouping: SiloGrouping;
  /**
   * El agrupamiento por carpeta deja casi todo en la raíz: el sitio es
   * plano y conviene mirarlo por slug.
   */
  flatSite: boolean;
  totalPages: number;
  analyzedPages: number;
  totalInternalLinks: number;
  crossSiloLinks: number;
  /** Proporción global de enlaces que se quedan dentro de su sección. */
  cohesion: number;
  silos: Silo[];
  flows: SiloFlow[];
  findings: SiloFinding[];
  truncated: boolean;
};

/** Tope de páginas cargadas en memoria; por encima el informe se recorta. */
const PAGE_LIMIT = 50_000;
/** Los enlaces se agregan por lotes para no traerse millones de filas. */
const LINK_BATCH = 20_000;

const ROOT_KEY = '/';

/**
 * Rutas de infraestructura que no son contenido: el protector de correo de
 * Cloudflare, la API y el escritorio de WordPress, los feeds. Aparecen como
 * páginas pero no forman parte de la arquitectura editorial.
 */
const SYSTEM_PREFIXES = ['/cdn-cgi', '/wp-json', '/wp-admin', '/wp-includes', '/feed'];

export function isSystemPath(url: string): boolean {
  const path = pathOf(url);
  return SYSTEM_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Segmentos de ruta que dan nombre al silo.
 *
 * Las URLs de la raíz (`/contacto`) van todas a un silo `/` en lugar de
 * inventarse una sección por página suelta.
 */
export function siloKeyFor(url: string, depth: SiloDepth): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return ROOT_KEY;
  }

  const segments = path.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });

  if (segments.length === 0) return ROOT_KEY;

  // Una única hoja (`/contacto`, `/aviso-legal.html`) no es una sección:
  // es una página de primer nivel.
  if (segments.length === 1) return ROOT_KEY;

  return `/${segments.slice(0, depth).join('/')}`;
}

/**
 * Silo por tema del slug: la primera palabra significativa de la última
 * porción de la URL. `/diseno-de-paginas-web/` y
 * `/diseno-de-plataformas-elearning/` caen las dos en `diseno`.
 */
export function slugKeyFor(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return ROOT_KEY;
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return ROOT_KEY;

  const slug = decodeURIComponent(segments[segments.length - 1])
    .replace(/\.[a-z0-9]{2,5}$/i, '');

  const token = slug
    .toLowerCase()
    .split(/[-_.]+/)
    .find((word) => word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word));

  return token ?? ROOT_KEY;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/** Portada de sección: su ruta es exactamente la del silo. */
function isHubPath(path: string, siloKey: string): boolean {
  if (siloKey === ROOT_KEY) return path === '/' || path === '';
  const clean = path.replace(/\/+$/, '');
  return clean === siloKey;
}

type PageRow = {
  id: bigint;
  normalizedUrl: string;
  title: string | null;
  statusCode: number | null;
  depth: number;
  internalInlinks: number;
  internalOutlinks: number;
  internalPageRank: number | null;
  indexable: boolean;
};

function toSiloPage(row: PageRow, siloKey: string): SiloPage {
  const path = pathOf(row.normalizedUrl);
  return {
    pageId: row.id.toString(),
    url: row.normalizedUrl,
    path,
    title: row.title,
    status: row.statusCode,
    depth: row.depth,
    inlinks: row.internalInlinks,
    outlinks: row.internalOutlinks,
    pagerank: row.internalPageRank ?? 0,
    indexable: row.indexable,
    isHub: isHubPath(path, siloKey),
  };
}

/**
 * Recorre la tabla de enlaces por lotes y cuenta cuántos van de cada silo a
 * cada silo. La matriz es O(silos²), así que la memoria no depende del
 * tamaño del sitio.
 */
async function buildFlowMatrix(
  crawlId: string,
  siloOf: Map<string, string>,
): Promise<{ matrix: Map<string, number>; total: number }> {
  const matrix = new Map<string, number>();
  let total = 0;
  let cursor: bigint | null = null;

  for (;;) {
    const links: { id: bigint; sourcePageId: bigint; targetPageId: bigint | null }[] =
      await prisma.link.findMany({
        where: {
          crawlId,
          targetPageId: { not: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, sourcePageId: true, targetPageId: true },
        orderBy: { id: 'asc' },
        take: LINK_BATCH,
      });

    if (links.length === 0) break;

    for (const link of links) {
      const from = siloOf.get(link.sourcePageId.toString());
      const to = siloOf.get(link.targetPageId!.toString());
      // Un extremo fuera del conjunto analizado (recorte por PAGE_LIMIT).
      if (from === undefined || to === undefined) continue;

      const key = `${from} ${to}`;
      matrix.set(key, (matrix.get(key) ?? 0) + 1);
      total += 1;
    }

    cursor = links[links.length - 1].id;
    if (links.length < LINK_BATCH) break;
  }

  return { matrix, total };
}

/**
 * Diagnóstico.
 *
 * Cada regla responde a una pregunta que se hace de verdad al auditar una
 * arquitectura, y ninguna se dispara sin un mínimo de páginas detrás: en
 * secciones diminutas los porcentajes no significan nada.
 */
function diagnose(
  silos: Silo[],
  flows: SiloFlow[],
  cohesion: number,
  flatSite: boolean,
  grouping: SiloGrouping,
): SiloFinding[] {
  const findings: SiloFinding[] = [];
  const pct = (value: number) => `${Math.round(value * 100)} %`;

  for (const silo of silos) {
    if (silo.key === ROOT_KEY) continue;

    if (grouping === 'path' && !silo.hub && silo.pages >= 3) {
      findings.push({
        code: 'SILO_SIN_CABECERA',
        severity: 'HIGH',
        silo: silo.key,
        title: `«${silo.label}» no tiene página cabecera`,
        detail:
          `La sección agrupa ${silo.pages} páginas pero no existe ${silo.key}. ` +
          'Sin una portada que las reúna, el silo no puede concentrar fuerza ni ' +
          'competir por el término genérico de la sección.',
      });
    }

    if (grouping === 'path' && silo.hub && silo.pages >= 3) {
      const children = silo.topPages.filter((page) => !page.isHub);
      const best = children[0];

      if (best && best.inlinks > silo.hub.inlinks) {
        findings.push({
          code: 'CABECERA_DEBIL',
          severity: 'MEDIUM',
          silo: silo.key,
          title: `La cabecera de «${silo.label}» recibe menos enlaces que sus hijas`,
          detail:
            `${silo.hub.path} tiene ${silo.hub.inlinks} enlaces internos, ` +
            `menos que ${best.path} (${best.inlinks}). En un silo la portada ` +
            'debería ser la más enlazada de su sección.',
        });
      }
    }

    if (silo.pages >= 5 && silo.internalLinks + silo.outboundLinks > 0) {
      const byPath = grouping === 'path';

      if (silo.cohesion < 0.3) {
        findings.push({
          code: 'SILO_DISPERSO',
          severity: 'HIGH',
          silo: silo.key,
          title: byPath
            ? `«${silo.label}» no funciona como silo`
            : `Las páginas de «${silo.label}» apenas se enlazan entre sí`,
          detail:
            `Sólo el ${pct(silo.cohesion)} de los enlaces que salen de estas ` +
            `${silo.pages} páginas va a otra página del mismo tema. El resto se ` +
            'reparte por todo el sitio, así que la temática no se refuerza a sí ' +
            'misma y Google no recibe la señal de que forman un bloque.',
        });
      } else if (silo.cohesion < 0.5) {
        findings.push({
          code: 'SILO_PERMEABLE',
          severity: 'MEDIUM',
          silo: silo.key,
          title: byPath
            ? `«${silo.label}» pierde más de la mitad de su enlazado`
            : `«${silo.label}» reparte más de la mitad de sus enlaces fuera del tema`,
          detail:
            `El ${pct(silo.cohesion)} se queda dentro. Suele ser una plantilla ` +
            'que enlaza a todo el sitio desde cada página: el menú y el pie ' +
            'pesan más que el enlazado editorial.',
        });
      }
    }

    if (grouping === 'path' && silo.pages >= 3 && silo.inboundLinks === 0) {
      findings.push({
        code: 'SILO_AISLADO',
        severity: 'HIGH',
        silo: silo.key,
        title: `Nadie enlaza a «${silo.label}»`,
        detail:
          `Ninguna página de otra sección enlaza a estas ${silo.pages}. ` +
          'La sección sólo se alcanza desde dentro de sí misma o desde el menú.',
      });
    }

    if (silo.orphans > 0) {
      findings.push({
        code: 'SILO_CON_HUERFANAS',
        severity: silo.orphans >= silo.pages / 2 ? 'HIGH' : 'MEDIUM',
        silo: silo.key,
        title:
          `${silo.orphans} de ${silo.pages} páginas de «${silo.label}» ` +
          'no reciben ningún enlace interno',
        detail:
          'Sin enlaces entrantes dependen del sitemap para ser descubiertas y ' +
          'no reciben nada de fuerza.',
      });
    }
  }

  // Fugas: pares de secciones con un trasiego desproporcionado.
  const ranked = [...flows]
    .filter((flow) => flow.from !== flow.to && flow.from !== ROOT_KEY)
    .sort((a, b) => b.links - a.links);

  for (const flow of ranked.slice(0, 3)) {
    const source = silos.find((silo) => silo.key === flow.from);
    if (!source || source.pages < 5) continue;
    const share = flow.links / Math.max(1, source.internalLinks + source.outboundLinks);
    if (share < 0.25) continue;

    findings.push({
      code: 'FUGA_ENTRE_SILOS',
      severity: 'MEDIUM',
      silo: flow.from,
      title: `«${flow.from}» manda el ${pct(share)} de su enlazado a «${flow.to}»`,
      detail:
        `${flow.links} enlaces cruzan de una sección a otra. Si no es ` +
        'intencionado, esa fuerza debería quedarse dentro de la sección de origen.',
    });
  }

  if (flatSite) {
    findings.push({
      code: 'SITIO_PLANO',
      severity: 'HIGH',
      silo: null,
      title: 'El sitio no tiene arquitectura de carpetas',
      detail:
        'Casi todas las URLs cuelgan directamente de la raíz, así que no hay ' +
        'secciones que analizar por ruta. Es lo normal en WordPress sin ' +
        'reescritura de permalinks. Cambia el agrupamiento a «por tema del ' +
        'slug» para ver los grupos temáticos que sí existen, y plantéate ' +
        'mover los servicios a /servicios/… si quieres silos de verdad.',
    });
  }

  if (grouping === 'path' && !flatSite && silos.length >= 3 && cohesion < 0.4) {
    findings.push({
      code: 'ARQUITECTURA_PLANA',
      severity: 'HIGH',
      silo: null,
      title: 'El sitio no está silado',
      detail:
        `Sólo el ${pct(cohesion)} de los enlaces internos se queda dentro de su ` +
        'propia sección. Es el patrón típico de un menú o un pie que enlaza a ' +
        'todo desde todas partes: ninguna sección acumula autoridad temática.',
    });
  }

  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

export async function analyzeSilos(
  crawlId: string,
  options: { depth?: SiloDepth; grouping?: SiloGrouping } = {},
): Promise<SiloReport> {
  const depth = options.depth ?? 1;
  const grouping = options.grouping ?? 'path';

  /**
   * Sólo documentos HTML.
   *
   * El crawler también guarda imágenes y PDFs que encuentra enlazados, y
   * sin este filtro un `/wp-content/uploads/` con cincuenta fotos aparece
   * como si fuera la sección más grande del sitio.
   */
  const htmlOnly = {
    crawlId,
    OR: [
      { contentType: { startsWith: 'text/html' } },
      { AND: [{ contentType: null }, { wordCount: { gt: 0 } }] },
    ],
  };

  const [totalPages, rows] = await Promise.all([
    prisma.page.count({ where: htmlOnly }),
    prisma.page.findMany({
      where: htmlOnly,
      select: {
        id: true,
        normalizedUrl: true,
        title: true,
        statusCode: true,
        depth: true,
        internalInlinks: true,
        internalOutlinks: true,
        internalPageRank: true,
        indexable: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE_LIMIT,
    }),
  ]);

  const siloOf = new Map<string, string>();
  const grouped = new Map<string, PageRow[]>();

  for (const row of rows) {
    if (isSystemPath(row.normalizedUrl)) continue;

    const key =
      grouping === 'slug'
        ? slugKeyFor(row.normalizedUrl)
        : siloKeyFor(row.normalizedUrl, depth);
    siloOf.set(row.id.toString(), key);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const { matrix, total: totalInternalLinks } = await buildFlowMatrix(crawlId, siloOf);

  const flows: SiloFlow[] = [];
  const internalOf = new Map<string, number>();
  const outboundOf = new Map<string, number>();
  const inboundOf = new Map<string, number>();

  for (const [key, links] of matrix) {
    const [from, to] = key.split(' ');
    flows.push({ from, to, links });

    if (from === to) {
      internalOf.set(from, (internalOf.get(from) ?? 0) + links);
    } else {
      outboundOf.set(from, (outboundOf.get(from) ?? 0) + links);
      inboundOf.set(to, (inboundOf.get(to) ?? 0) + links);
    }
  }

  const totalPagerank = rows.reduce((sum, row) => sum + (row.internalPageRank ?? 0), 0);

  const silos: Silo[] = [...grouped.entries()].map(([key, bucket]) => {
    const pages = bucket.map((row) => toSiloPage(row, key));
    const sorted = [...pages].sort(
      (a, b) => b.inlinks - a.inlinks || b.pagerank - a.pagerank,
    );

    const internalLinks = internalOf.get(key) ?? 0;
    const outboundLinks = outboundOf.get(key) ?? 0;
    const emitted = internalLinks + outboundLinks;
    const pagerank = pages.reduce((sum, page) => sum + page.pagerank, 0);

    return {
      key,
      label:
        key === ROOT_KEY
          ? grouping === 'slug'
            ? 'Sin tema común'
            : 'Raíz del sitio'
          : key,
      pages: pages.length,
      indexablePages: pages.filter((page) => page.indexable).length,
      // La home no cuenta como huérfana: se llega por el dominio.
      orphans: pages.filter((page) => page.inlinks === 0 && page.path !== '/').length,
      avgDepth:
        pages.reduce((sum, page) => sum + page.depth, 0) / Math.max(1, pages.length),
      pagerank,
      pagerankShare: totalPagerank > 0 ? pagerank / totalPagerank : 0,
      internalLinks,
      outboundLinks,
      inboundLinks: inboundOf.get(key) ?? 0,
      cohesion: emitted > 0 ? internalLinks / emitted : 0,
      /**
       * Por carpeta la cabecera es la portada de la sección. Por slug no
       * existe tal portada, así que se toma la URL más corta del grupo:
       * `/diseno-de-paginas-web/` frente a
       * `/diseno-de-paginas-web-para-inmobiliarias/`.
       */
      hub:
        grouping === 'path'
          ? (pages.find((page) => page.isHub) ?? null)
          : key === ROOT_KEY
            ? null
            : ([...pages].sort((a, b) => a.path.length - b.path.length)[0] ?? null),
      topPages: sorted.slice(0, 25),
    };
  });

  silos.sort((a, b) => b.pages - a.pages || a.key.localeCompare(b.key));
  flows.sort((a, b) => b.links - a.links);

  const crossSiloLinks = flows
    .filter((flow) => flow.from !== flow.to)
    .reduce((sum, flow) => sum + flow.links, 0);

  const cohesion =
    totalInternalLinks > 0
      ? (totalInternalLinks - crossSiloLinks) / totalInternalLinks
      : 0;

  // Si por carpetas casi todo cae en la raíz, no hay jerarquía que analizar.
  const rootPages = grouped.get(ROOT_KEY)?.length ?? 0;
  const flatSite =
    grouping === 'path' && rows.length > 0 && rootPages / rows.length > 0.7;

  return {
    depth,
    grouping,
    flatSite,
    totalPages,
    analyzedPages: rows.length,
    totalInternalLinks,
    crossSiloLinks,
    cohesion,
    silos,
    flows,
    findings: diagnose(silos, flows, cohesion, flatSite, grouping),
    truncated: rows.length < totalPages,
  };
}
