import Link from 'next/link';
import { SEVERITY_COLORS, statusColor } from '@/lib/format';

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'bad' | 'accent';
  href?: string;
}) {
  const tones = {
    default: 'text-fg',
    ok: 'text-ok',
    warn: 'text-warn',
    bad: 'text-bad',
    accent: 'text-accent',
  };

  const content = (
    <div className="card h-full transition hover:border-accent/40">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`badge border ${SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.INFO}`}>
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: number | null | undefined }) {
  return (
    <span className={`badge ${statusColor(status)}`}>{status ?? 'ERR'}</span>
  );
}

export function IndexableBadge({
  indexable,
  reason,
}: {
  indexable: boolean;
  reason?: string;
}) {
  return (
    <span
      className={`badge ${indexable ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted'}`}
      title={reason}
    >
      {indexable ? 'Indexable' : (reason ?? 'No indexable')}
    </span>
  );
}

export function CrawlStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'bg-panel2 text-muted',
    QUEUED: 'bg-accent/15 text-accent',
    RUNNING: 'bg-accent/20 text-accent animate-pulse',
    PAUSED: 'bg-warn/15 text-warn',
    COMPLETED: 'bg-ok/15 text-ok',
    FAILED: 'bg-bad/20 text-bad',
    CANCELLED: 'bg-panel2 text-muted',
  };
  return <span className={`badge ${map[status] ?? 'bg-panel2'}`}>{status}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Barra horizontal simple para distribuciones. */
export function BarRow({
  label,
  value,
  total,
  color = 'bg-accent',
  href,
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
  href?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const inner = (
    <>
      <div className="flex items-center justify-between text-xs">
        <span className="truncate">{label}</span>
        <span className="ml-2 shrink-0 text-muted">
          {value.toLocaleString('es-ES')} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-panel2">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </>
  );

  return (
    <div className="py-1.5">
      {href ? (
        <Link href={href} className="block hover:opacity-80">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  );
}
