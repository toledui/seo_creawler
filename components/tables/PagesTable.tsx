'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatNumber, pathOf, truncate } from '@/lib/format';
import { StatusBadge } from '@/components/ui';

type PageRow = {
  id: string;
  normalizedUrl: string;
  statusCode: number | null;
  resourceType: string | null;
  mediaType: string | null;
  contentType: string | null;
  title: string | null;
  titleLength: number | null;
  metaDescription: string | null;
  metaDescriptionLength: number | null;
  h1: string | null;
  h1Count: number;
  canonical: string | null;
  metaRobots: string | null;
  indexable: boolean;
  indexabilityReason: string;
  wordCount: number;
  depth: number;
  internalInlinks: number;
  internalOutlinks: number;
  externalOutlinks: number;
  internalPageRank: number | null;
  responseTime: number | null;
  errorType: string | null;
  potentialOrphan: boolean;
};

type Column = {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'right';
  render: (page: PageRow) => React.ReactNode;
  defaultVisible?: boolean;
};

const COLUMNS: Column[] = [
  {
    key: 'url',
    label: 'URL',
    sortable: true,
    defaultVisible: true,
    render: (p) => (
      <Link href={`/pages/${p.id}`} className="link font-mono text-xs" title={p.normalizedUrl}>
        {truncate(pathOf(p.normalizedUrl), 60)}
      </Link>
    ),
  },
  {
    key: 'statusCode',
    label: 'Status',
    sortable: true,
    defaultVisible: true,
    render: (p) => <StatusBadge status={p.statusCode} />,
  },
  {
    // Saber de un vistazo si la fila es una página o un recurso evita leer
    // columnas on-page (title, H1…) que en un asset siempre están vacías.
    key: 'resourceType',
    label: 'Tipo',
    defaultVisible: true,
    render: (p) => (
      <span className="text-xs text-muted">{p.resourceType ?? 'HTML_PAGE'}</span>
    ),
  },
  {
    key: 'contentType',
    label: 'Content Type',
    render: (p) => <span className="text-xs text-muted">{p.contentType ?? '—'}</span>,
  },
  {
    key: 'title',
    label: 'Title',
    defaultVisible: true,
    render: (p) => <span title={p.title ?? ''}>{truncate(p.title, 55) || '—'}</span>,
  },
  {
    key: 'titleLength',
    label: 'Title Len',
    sortable: true,
    align: 'right',
    render: (p) => p.titleLength ?? '—',
  },
  {
    key: 'metaDescription',
    label: 'Meta Description',
    render: (p) => truncate(p.metaDescription, 55) || '—',
  },
  {
    key: 'metaDescriptionLength',
    label: 'Desc Len',
    sortable: true,
    align: 'right',
    render: (p) => p.metaDescriptionLength ?? '—',
  },
  { key: 'h1', label: 'H1', render: (p) => truncate(p.h1, 40) || '—' },
  { key: 'h1Count', label: 'H1 Count', align: 'right', render: (p) => p.h1Count },
  {
    key: 'canonical',
    label: 'Canonical',
    render: (p) => (
      <span className="font-mono text-[11px] text-muted">
        {p.canonical ? truncate(pathOf(p.canonical), 40) : '—'}
      </span>
    ),
  },
  {
    key: 'metaRobots',
    label: 'Robots',
    render: (p) => <span className="text-xs">{p.metaRobots ?? '—'}</span>,
  },
  {
    key: 'indexable',
    label: 'Indexable',
    defaultVisible: true,
    render: (p) => (
      <span className={`badge ${p.indexable ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted'}`}>
        {p.indexable ? 'Sí' : p.indexabilityReason}
      </span>
    ),
  },
  {
    key: 'wordCount',
    label: 'Words',
    sortable: true,
    align: 'right',
    defaultVisible: true,
    render: (p) => formatNumber(p.wordCount),
  },
  {
    key: 'depth',
    label: 'Depth',
    sortable: true,
    align: 'right',
    defaultVisible: true,
    render: (p) => p.depth,
  },
  {
    key: 'internalInlinks',
    label: 'Inlinks',
    sortable: true,
    align: 'right',
    defaultVisible: true,
    render: (p) => formatNumber(p.internalInlinks),
  },
  {
    key: 'internalOutlinks',
    label: 'Outlinks',
    sortable: true,
    align: 'right',
    defaultVisible: true,
    render: (p) => formatNumber(p.internalOutlinks),
  },
  {
    key: 'externalOutlinks',
    label: 'External',
    sortable: true,
    align: 'right',
    render: (p) => formatNumber(p.externalOutlinks),
  },
  {
    key: 'internalPageRank',
    label: 'PageRank',
    sortable: true,
    align: 'right',
    defaultVisible: true,
    render: (p) =>
      p.internalPageRank != null ? p.internalPageRank.toExponential(2) : '—',
  },
  {
    key: 'responseTime',
    label: 'Resp (ms)',
    sortable: true,
    align: 'right',
    render: (p) => (p.responseTime != null ? formatNumber(p.responseTime) : '—'),
  },
];

export function PagesTable({ crawlId }: { crawlId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<PageRow[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: 50,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState<string[]>(
    COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
  );
  const [showColumns, setShowColumns] = useState(false);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  const query = searchParams.toString();

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in updates)) next.delete('page');
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/crawls/${crawlId}/pages?${query}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setRows(body.pages ?? []);
        if (body.pagination) setPagination(body.pagination);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [crawlId, query]);

  const sort = searchParams.get('sort') ?? 'internalPageRank';
  const dir = searchParams.get('dir') ?? 'desc';

  const columns = useMemo(
    () => COLUMNS.filter((c) => visible.includes(c.key)),
    [visible],
  );

  function toggleSort(key: string) {
    if (sort === key) setParam({ dir: dir === 'asc' ? 'desc' : 'asc' });
    else setParam({ sort: key, dir: 'desc' });
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="card flex flex-wrap items-end gap-3">
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ search: search || null });
          }}
        >
          <label className="label">Buscar URL o title</label>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="/blog/"
          />
        </form>

        <Select
          label="Status"
          value={searchParams.get('status') ?? ''}
          onChange={(v) => setParam({ status: v })}
          options={[
            ['', 'Todos'],
            ['2xx', '2xx'],
            ['3xx', '3xx'],
            ['4xx', '4xx'],
            ['5xx', '5xx'],
            ['error', 'Sin respuesta'],
          ]}
        />

        <Select
          label="Indexable"
          value={searchParams.get('indexable') ?? ''}
          onChange={(v) => setParam({ indexable: v })}
          options={[
            ['', 'Todas'],
            ['true', 'Sólo indexables'],
            ['false', 'No indexables'],
          ]}
        />

        <div>
          <label className="label">Inlinks máx.</label>
          <input
            type="number"
            className="input w-28"
            value={searchParams.get('maxInlinks') ?? ''}
            onChange={(e) => setParam({ maxInlinks: e.target.value })}
          />
        </div>

        <div>
          <label className="label">Depth mín.</label>
          <input
            type="number"
            className="input w-24"
            value={searchParams.get('minDepth') ?? ''}
            onChange={(e) => setParam({ minDepth: e.target.value })}
          />
        </div>

        <button
          className="btn"
          onClick={() => {
            setSearch('');
            router.replace(pathname, { scroll: false });
          }}
        >
          Limpiar
        </button>

        <div className="relative">
          <button className="btn" onClick={() => setShowColumns((v) => !v)}>
            Columnas ({visible.length})
          </button>
          {showColumns && (
            <div className="absolute right-0 z-20 mt-1 max-h-80 w-56 overflow-y-auto rounded border border-line bg-panel p-2 shadow-xl">
              {COLUMNS.map((column) => (
                <label
                  key={column.key}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-panel2"
                >
                  <input
                    type="checkbox"
                    className="accent-[#4f9dff]"
                    checked={visible.includes(column.key)}
                    onChange={(e) =>
                      setVisible((cols) =>
                        e.target.checked
                          ? [...cols, column.key]
                          : cols.filter((c) => c !== column.key),
                      )
                    }
                  />
                  {column.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <a
          className="btn"
          href={`/api/crawls/${crawlId}/export/pages.csv`}
          download
        >
          Exportar CSV
        </a>
      </div>

      {/* Tabla */}
      <div className="card max-h-[70vh] overflow-auto p-0">
        <table className="table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.align === 'right' ? 'text-right' : undefined}
                >
                  {column.sortable ? (
                    <button
                      className="hover:text-fg"
                      onClick={() => toggleSort(column.key)}
                    >
                      {column.label}
                      {sort === column.key && (dir === 'asc' ? ' ↑' : ' ↓')}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-muted">
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-muted">
                  No hay URLs que coincidan con los filtros.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((page) => (
                <tr key={page.id}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={
                        column.align === 'right'
                          ? 'whitespace-nowrap text-right tabular-nums'
                          : undefined
                      }
                    >
                      {column.render(page)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          {formatNumber(pagination.total)} URLs · página {pagination.page} de{' '}
          {Math.max(1, pagination.totalPages)}
        </span>
        <div className="flex items-center gap-2">
          <select
            className="input w-auto py-1"
            value={pagination.perPage}
            onChange={(e) => setParam({ perPage: e.target.value, page: '1' })}
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} / página
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={pagination.page <= 1}
            onClick={() => setParam({ page: String(pagination.page - 1) })}
          >
            ← Anterior
          </button>
          <button
            className="btn"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setParam({ page: String(pagination.page + 1) })}
          >
            Siguiente →
          </button>
        </div>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select
        className="input w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
