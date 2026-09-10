export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-ES').format(value);
}

export function formatPercent(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function truncate(value: string | null | undefined, max = 80): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname + u.search) || '/';
  } catch {
    return url;
  }
}

export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-bad/20 text-bad border-bad/40',
  HIGH: 'bg-warn/20 text-warn border-warn/40',
  MEDIUM: 'bg-accent/15 text-accent border-accent/40',
  LOW: 'bg-panel2 text-muted border-line',
  INFO: 'bg-panel2 text-muted border-line',
};

export function statusColor(status: number | null | undefined): string {
  if (status == null) return 'bg-bad/20 text-bad';
  if (status < 300) return 'bg-ok/15 text-ok';
  if (status < 400) return 'bg-warn/15 text-warn';
  return 'bg-bad/20 text-bad';
}
