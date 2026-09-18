import type { AuditReport } from '../ai/prompts/executive-report';
import type { ComparisonReport } from '../ai/prompts/compare-reports';
import { requestedUrlsOf, type CrawlStats } from '../analysis/analyze-crawl';

/**
 * Modelo neutro de documento.
 *
 * Los tres formatos (Markdown, PDF y Word) se generan desde aquí, así que
 * la estructura del informe se define una sola vez y no hay que mantener
 * tres maquetaciones en paralelo.
 */

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'facts'; items: { label: string; value: string }[] }
  | { type: 'divider' };

export type ReportDocument = {
  title: string;
  subtitle: string;
  /** Nombre de archivo sin extensión. */
  filename: string;
  blocks: Block[];
};

export type ReportMeta = {
  projectName: string;
  domain: string;
  startUrl: string;
  model: string;
  createdAt: Date;
  crawledUrls: number;
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Descarta secciones vacías para que el documento no tenga huecos. */
function push(blocks: Block[], ...items: (Block | null)[]) {
  for (const item of items) if (item) blocks.push(item);
}

// ------------------------------------------------------------- Auditoría

export function auditDocument(
  report: AuditReport,
  meta: ReportMeta,
): ReportDocument {
  const blocks: Block[] = [];

  push(
    blocks,
    {
      type: 'facts',
      items: [
        { label: 'Proyecto', value: meta.projectName },
        { label: 'Dominio', value: meta.domain },
        { label: 'URLs solicitadas', value: meta.crawledUrls.toLocaleString('es-ES') },
        { label: 'Score IA', value: `${report.score}/100` },
        { label: 'Generado', value: formatDate(meta.createdAt) },
        { label: 'Modelo', value: meta.model },
      ],
    },
    { type: 'divider' },
    { type: 'heading', level: 2, text: 'Resumen ejecutivo' },
    { type: 'paragraph', text: report.summary },
    report.seoHealth
      ? { type: 'paragraph', text: report.seoHealth }
      : null,
  );

  if (report.criticalIssues.length > 0) {
    push(blocks, { type: 'heading', level: 2, text: 'Problemas críticos' });
    for (const issue of report.criticalIssues) {
      push(
        blocks,
        { type: 'heading', level: 3, text: issue.title },
        { type: 'paragraph', text: issue.impact },
        issue.evidence
          ? { type: 'paragraph', text: `Evidencia: ${issue.evidence}` }
          : null,
        issue.affectedUrls?.length
          ? { type: 'bullets', items: issue.affectedUrls.slice(0, 10) }
          : null,
      );
    }
  }

  if (report.highPriorityIssues.length > 0) {
    push(blocks, { type: 'heading', level: 2, text: 'Prioridad alta' });
    for (const issue of report.highPriorityIssues) {
      push(
        blocks,
        { type: 'heading', level: 3, text: issue.title },
        { type: 'paragraph', text: issue.impact },
        issue.evidence ? { type: 'paragraph', text: issue.evidence } : null,
      );
    }
  }

  if (report.internalLinking) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'Enlazado interno' },
      { type: 'paragraph', text: report.internalLinking.diagnosis },
      report.internalLinking.wastedPageRank
        ? { type: 'paragraph', text: report.internalLinking.wastedPageRank }
        : null,
      report.internalLinking.pagesToBoost?.length
        ? { type: 'heading', level: 3, text: 'Páginas a reforzar' }
        : null,
      report.internalLinking.pagesToBoost?.length
        ? { type: 'bullets', items: report.internalLinking.pagesToBoost.slice(0, 15) }
        : null,
      report.internalLinking.recommendations?.length
        ? { type: 'bullets', items: report.internalLinking.recommendations }
        : null,
    );
  }

  if (report.technicalSeo?.findings?.length) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'SEO técnico' },
      { type: 'bullets', items: report.technicalSeo.findings },
    );
  }

  if (report.contentFindings?.findings?.length) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'Contenido' },
      { type: 'bullets', items: report.contentFindings.findings },
    );
  }

  if (report.geo) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'GEO Readiness' },
      { type: 'paragraph', text: report.geo.readiness },
      report.geo.gaps?.length
        ? { type: 'heading', level: 3, text: 'Carencias' }
        : null,
      report.geo.gaps?.length ? { type: 'bullets', items: report.geo.gaps } : null,
      report.geo.recommendations?.length
        ? { type: 'heading', level: 3, text: 'Recomendaciones' }
        : null,
      report.geo.recommendations?.length
        ? { type: 'bullets', items: report.geo.recommendations }
        : null,
    );
  }

  if (report.recommendations.length > 0) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'Acciones recomendadas' },
      {
        type: 'table',
        headers: ['#', 'Acción', 'Justificación', 'Impacto esperado', 'Esfuerzo'],
        rows: [...report.recommendations]
          .sort((a, b) => a.priority - b.priority)
          .map((rec) => [
            String(rec.priority),
            rec.action,
            rec.rationale ?? '',
            rec.expectedImpact ?? '',
            rec.effort ?? '',
          ]),
      },
    );
  }

  if (report.implementationOrder.length > 0) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'Orden de implementación' },
      { type: 'numbered', items: report.implementationOrder },
    );
  }

  return {
    title: `Auditoría SEO y GEO · ${meta.projectName}`,
    subtitle: `${meta.domain} · ${formatDate(meta.createdAt)}`,
    filename: `auditoria-${slug(meta.projectName)}-${meta.createdAt
      .toISOString()
      .slice(0, 10)}`,
    blocks,
  };
}

// ----------------------------------------------------------- Comparación

export function comparisonDocument(
  report: ComparisonReport,
  meta: ReportMeta & { beforeDate: Date | null; afterDate: Date | null },
): ReportDocument {
  const blocks: Block[] = [];

  push(
    blocks,
    {
      type: 'facts',
      items: [
        { label: 'Proyecto', value: meta.projectName },
        { label: 'Dominio', value: meta.domain },
        {
          label: 'Periodo',
          value:
            meta.beforeDate && meta.afterDate
              ? `${formatDate(meta.beforeDate)} → ${formatDate(meta.afterDate)}`
              : '—',
        },
        { label: 'Veredicto', value: report.verdict },
        {
          label: 'Variación de score',
          value: `${report.scoreDelta > 0 ? '+' : ''}${report.scoreDelta}`,
        },
        { label: 'Modelo', value: meta.model },
      ],
    },
    { type: 'divider' },
    { type: 'heading', level: 2, text: 'Evolución' },
    { type: 'paragraph', text: report.summary },
  );

  const section = (
    title: string,
    items: { title: string; lines: (string | undefined)[] }[],
  ) => {
    if (items.length === 0) return;
    push(blocks, { type: 'heading', level: 2, text: `${title} (${items.length})` });
    for (const item of items) {
      push(blocks, { type: 'heading', level: 3, text: item.title });
      for (const line of item.lines) {
        if (line) push(blocks, { type: 'paragraph', text: line });
      }
    }
  };

  section(
    'Resuelto',
    report.resolved.map((x) => ({ title: x.title, lines: [x.evidence] })),
  );
  section(
    'Sigue igual',
    report.persisting.map((x) => ({
      title: x.title,
      lines: [x.evidence, x.whyItMatters],
    })),
  );
  section(
    'Ha empeorado',
    report.regressions.map((x) => ({
      title: x.title,
      lines: [x.evidence, x.impact],
    })),
  );

  if (report.recommendationsStatus.length > 0) {
    push(
      blocks,
      {
        type: 'heading',
        level: 2,
        text: 'Estado de las recomendaciones anteriores',
      },
      {
        type: 'table',
        headers: ['Acción recomendada', 'Estado', 'Evidencia'],
        rows: report.recommendationsStatus.map((row) => [
          row.action,
          row.status,
          row.evidence ?? '',
        ]),
      },
    );
  }

  if (report.nextActions.length > 0) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'Siguientes pasos' },
      {
        type: 'numbered',
        items: [...report.nextActions]
          .sort((a, b) => a.priority - b.priority)
          .map((action) =>
            action.rationale
              ? `${action.action} — ${action.rationale}`
              : action.action,
          ),
      },
    );
  }

  return {
    title: `Comparativa de auditorías · ${meta.projectName}`,
    subtitle: `${meta.domain} · ${formatDate(meta.createdAt)}`,
    filename: `comparativa-${slug(meta.projectName)}-${meta.createdAt
      .toISOString()
      .slice(0, 10)}`,
    blocks,
  };
}

// --------------------------------------------------------- Crawl técnico

export type CrawlMeta = {
  projectName: string;
  domain: string;
  startUrl: string;
  status: string;
  crawledUrls: number;
  discoveredUrls: number;
  failedUrls: number;
  startedAt: Date | null;
  completedAt: Date | null;
  generatedAt: Date;
};

/**
 * Informe del rastreo en sí (sin IA): las métricas que ya calcula
 * `analyzeCrawl`, maquetadas para poder enviarlas o archivarlas.
 */
/** Un ratio 0–1 como porcentaje legible. */
function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Secciones de recursos e imágenes.
 *
 * Los rastreos anteriores a la clasificación de recursos no las traen: no
 * se midieron, y sacar ceros sería mentir. En ese caso el informe lo dice.
 */
function resourceBlocks(stats: CrawlStats): Block[] {
  const { resources, images } = stats;

  if (!resources || !images) {
    return [
      { type: 'heading', level: 2, text: 'Recursos descubiertos' },
      {
        type: 'paragraph',
        text: 'Este rastreo es anterior a la separación entre páginas y recursos, así que sus cifras cuentan imágenes, CSS y JS como si fueran páginas. Relanza el rastreo para obtener el inventario de recursos y la auditoría de imágenes.',
      },
    ];
  }

  return [
    { type: 'heading', level: 2, text: 'Recursos descubiertos' },
    {
      type: 'table',
      headers: ['Métrica', 'Valor'],
      rows: [
        ['Recursos (no HTML)', resources.discovered.toLocaleString('es-ES')],
        ...Object.entries(resources.byType)
          .filter(([type]) => type !== 'HTML_PAGE')
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]): [string, string] => [
            `· ${type}`,
            count.toLocaleString('es-ES'),
          ]),
        ['Imágenes solicitadas', resources.images.toLocaleString('es-ES')],
        [
          'Imágenes rotas',
          `${resources.brokenImages.toLocaleString('es-ES')} (${percent(resources.brokenImagesRatio)} de las imágenes solicitadas)`,
        ],
        ['Recursos rotos', resources.broken.toLocaleString('es-ES')],
        ['Extensión ≠ Content-Type', resources.mimeMismatches.toLocaleString('es-ES')],
      ],
    },

    { type: 'heading', level: 2, text: 'Imágenes dentro de páginas HTML' },
    {
      type: 'table',
      headers: ['Métrica', 'Valor'],
      rows: [
        ['Elementos <img> auditados', images.elements.toLocaleString('es-ES')],
        [
          'Sin atributo alt',
          `${images.missingAlt.toLocaleString('es-ES')} (${percent(images.missingAltRatio)} de los <img> auditados)`,
        ],
        [
          'Decorativas (alt="")',
          `${images.decorativeAlt.toLocaleString('es-ES')} · válido, sólo informativo`,
        ],
        ['Con alt descriptivo', images.describedAlt.toLocaleString('es-ES')],
        [
          'Páginas afectadas por imágenes sin alt',
          images.pagesWithMissingAlt.toLocaleString('es-ES'),
        ],
      ],
    },
  ];
}

export function crawlDocument(
  stats: CrawlStats,
  meta: CrawlMeta,
): ReportDocument {
  const blocks: Block[] = [];
  const { totals } = stats;

  const duration =
    meta.startedAt && meta.completedAt
      ? Math.round(
          (meta.completedAt.getTime() - meta.startedAt.getTime()) / 1000,
        )
      : null;

  push(
    blocks,
    {
      type: 'facts',
      items: [
        { label: 'Proyecto', value: meta.projectName },
        { label: 'Dominio', value: meta.domain },
        { label: 'Estado', value: meta.status },
        { label: 'URLs solicitadas', value: meta.crawledUrls.toLocaleString('es-ES') },
        { label: 'Páginas HTML', value: totals.pages.toLocaleString('es-ES') },
        { label: 'URLs descubiertas', value: meta.discoveredUrls.toLocaleString('es-ES') },
        { label: 'Fallidas', value: meta.failedUrls.toLocaleString('es-ES') },
        { label: 'SEO Health', value: `${stats.seoHealth}/100` },
        { label: 'GEO Readiness', value: `${stats.geo.score}/100` },
        {
          label: 'Duración',
          value: duration == null ? '—' : `${Math.floor(duration / 60)}m ${duration % 60}s`,
        },
      ],
    },
    { type: 'divider' },

    { type: 'heading', level: 2, text: 'Resumen del rastreo' },
    {
      type: 'table',
      headers: ['Métrica', 'Valor'],
      rows: [
        ['URL de inicio', meta.startUrl],
        ['Páginas HTML analizadas', totals.pages.toLocaleString('es-ES')],
        [
          'URLs solicitadas (con recursos)',
          requestedUrlsOf(stats).toLocaleString('es-ES'),
        ],
        ['Indexables', totals.indexable.toLocaleString('es-ES')],
        ['No indexables', totals.nonIndexable.toLocaleString('es-ES')],
        ['Errores', totals.errors.toLocaleString('es-ES')],
        ['Redirecciones', totals.redirects.toLocaleString('es-ES')],
        ['Enlaces internos', totals.internalLinks.toLocaleString('es-ES')],
        ['Enlaces externos', totals.externalLinks.toLocaleString('es-ES')],
        ['Profundidad media', totals.averageDepth.toFixed(1)],
        ['Tiempo de respuesta medio', `${Math.round(totals.averageResponseTime)} ms`],
        ['Palabras por página (media)', Math.round(totals.averageWordCount).toLocaleString('es-ES')],
        ['Análisis calculado', formatDate(new Date(stats.computedAt))],
      ],
    },

    ...resourceBlocks(stats),
  );

  const distribution = (title: string, data: Record<string, number>) => {
    const rows = Object.entries(data ?? {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => [key, count.toLocaleString('es-ES')]);

    if (rows.length === 0) return;

    push(
      blocks,
      { type: 'heading', level: 3, text: title },
      { type: 'table', headers: ['Valor', 'Páginas'], rows },
    );
  };

  push(blocks, { type: 'heading', level: 2, text: 'Distribuciones' });
  distribution('Códigos de estado', stats.statusDistribution);
  distribution('Profundidad de clic', stats.depthDistribution);
  distribution('Indexabilidad', stats.indexabilityDistribution);

  if (stats.topIssues?.length) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'Incidencias detectadas' },
      {
        type: 'table',
        headers: ['Severidad', 'Incidencia', 'Código', 'Páginas'],
        rows: stats.topIssues
          .slice(0, 30)
          .map((issue) => [
            issue.severity,
            issue.title,
            issue.code,
            issue.count.toLocaleString('es-ES'),
          ]),
      },
    );
  }

  if (stats.directories?.length) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'Directorios principales' },
      {
        type: 'table',
        headers: ['Directorio', 'Páginas', 'Indexables'],
        rows: stats.directories
          .slice(0, 25)
          .map((dir) => [
            dir.directory || '/',
            dir.pages.toLocaleString('es-ES'),
            dir.indexable.toLocaleString('es-ES'),
          ]),
      },
    );
  }

  if (stats.geo?.categories?.length) {
    push(
      blocks,
      { type: 'heading', level: 2, text: `GEO Readiness (${stats.geo.score}/100)` },
      {
        type: 'table',
        headers: ['Categoría', 'Puntuación', 'Detalle'],
        rows: stats.geo.categories.map((category) => [
          category.label,
          `${category.score}/${category.max}`,
          category.detail,
        ]),
      },
    );
  }

  const architecture = stats.architecture;

  if (architecture) {
    push(
      blocks,
      { type: 'heading', level: 2, text: 'Arquitectura del sitio' },
      {
        type: 'paragraph',
        text: `${architecture.communities} comunidad(es) detectada(s)${
          architecture.modularity != null
            ? `, modularidad ${architecture.modularity.toFixed(3)}`
            : ''
        }.`,
      },
    );

    if (architecture.clusters?.length) {
      push(blocks, {
        type: 'table',
        headers: ['Cluster', 'Páginas', 'URL representativa', 'Prof. media', 'Entradas externas'],
        rows: architecture.clusters
          .slice(0, 15)
          .map((cluster) => [
            String(cluster.clusterId),
            cluster.pages.toLocaleString('es-ES'),
            cluster.topUrl,
            cluster.avgDepth.toFixed(1),
            cluster.inboundFromOtherClusters.toLocaleString('es-ES'),
          ]),
      });
    }

    const ranking = (title: string, rows: string[][]) => {
      if (rows.length === 0) return;
      push(
        blocks,
        { type: 'heading', level: 3, text: title },
        { type: 'table', headers: ['URL', 'Valor'], rows },
      );
    };

    ranking(
      'Cuellos de botella (betweenness)',
      (architecture.topBottlenecks ?? [])
        .slice(0, 10)
        .map((item) => [item.url, item.betweenness.toFixed(4)]),
    );
    ranking(
      'Hubs',
      (architecture.topHubs ?? [])
        .slice(0, 10)
        .map((item) => [item.url, item.hubScore.toFixed(4)]),
    );
    ranking(
      'Autoridades',
      (architecture.topAuthorities ?? [])
        .slice(0, 10)
        .map((item) => [item.url, item.authorityScore.toFixed(4)]),
    );
  }

  return {
    title: `Informe de rastreo · ${meta.projectName}`,
    subtitle: `${meta.domain} · ${formatDate(meta.generatedAt)}`,
    filename: `crawl-${slug(meta.projectName)}-${meta.generatedAt
      .toISOString()
      .slice(0, 10)}`,
    blocks,
  };
}
