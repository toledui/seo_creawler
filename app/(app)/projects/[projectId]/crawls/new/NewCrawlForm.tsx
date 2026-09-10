'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NewCrawlForm({
  projectId,
  defaultUrl,
}: {
  projectId: string;
  defaultUrl: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const [form, setForm] = useState({
    startUrl: defaultUrl,
    maxUrls: 10_000,
    maxDepth: 10,
    concurrency: 10,
    delayMs: 100,
    respectRobots: true,
    followSubdomains: false,
    followNofollow: false,
    useSitemaps: true,
    userAgent: '',
    includePatterns: '',
    excludePatterns: '',
  });

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/projects/${projectId}/crawls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        userAgent: form.userAgent || undefined,
        includePatterns: form.includePatterns || undefined,
        excludePatterns: form.excludePatterns || undefined,
        start: true,
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? 'No se pudo crear el crawl');
      setLoading(false);
      return;
    }

    router.push(`/projects/${projectId}/crawls/${body.crawl.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-5">
      <h1 className="text-lg font-semibold">Nuevo crawl</h1>

      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <div>
        <label className="label" htmlFor="startUrl">
          Start URL
        </label>
        <input
          id="startUrl"
          className="input"
          value={form.startUrl}
          onChange={(e) => setField('startUrl', e.target.value)}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Max URLs"
          value={form.maxUrls}
          min={1}
          max={200_000}
          onChange={(v) => setField('maxUrls', v)}
        />
        <NumberField
          label="Max Depth"
          value={form.maxDepth}
          min={0}
          max={50}
          onChange={(v) => setField('maxDepth', v)}
        />
        <NumberField
          label="Concurrencia"
          value={form.concurrency}
          min={1}
          max={50}
          onChange={(v) => setField('concurrency', v)}
        />
        <NumberField
          label="Delay (ms)"
          value={form.delayMs}
          min={0}
          max={10_000}
          onChange={(v) => setField('delayMs', v)}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle
          label="Respetar robots.txt"
          checked={form.respectRobots}
          onChange={(v) => setField('respectRobots', v)}
        />
        <Toggle
          label="Usar sitemaps"
          checked={form.useSitemaps}
          onChange={(v) => setField('useSitemaps', v)}
        />
        <Toggle
          label="Seguir subdominios"
          checked={form.followSubdomains}
          onChange={(v) => setField('followSubdomains', v)}
        />
        <Toggle
          label="Seguir enlaces nofollow"
          checked={form.followNofollow}
          onChange={(v) => setField('followNofollow', v)}
        />
      </div>

      <button
        type="button"
        className="link text-xs"
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? '− Ocultar' : '+ Mostrar'} opciones avanzadas
      </button>

      {advanced && (
        <div className="space-y-4 border-t border-line pt-4">
          <div>
            <label className="label" htmlFor="userAgent">
              User Agent
            </label>
            <input
              id="userAgent"
              className="input"
              placeholder="Se usará el de .env si lo dejas vacío"
              value={form.userAgent}
              onChange={(e) => setField('userAgent', e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="includePatterns">
              Include patterns
            </label>
            <textarea
              id="includePatterns"
              className="input h-20 font-mono text-xs"
              placeholder={'^https://acme\\.com/blog/\nuna expresión regular por línea'}
              value={form.includePatterns}
              onChange={(e) => setField('includePatterns', e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="excludePatterns">
              Exclude patterns
            </label>
            <textarea
              id="excludePatterns"
              className="input h-20 font-mono text-xs"
              placeholder={'/carrito\n\\?orderby='}
              value={form.excludePatterns}
              onChange={(e) => setField('excludePatterns', e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Una expresión regular por línea. Si no es válida se usa como
              subcadena literal.
            </p>
          </div>
        </div>
      )}

      <button className="btn btn-primary w-full" disabled={loading}>
        {loading ? 'Encolando…' : 'Lanzar crawl'}
      </button>

      <p className="text-xs text-muted">
        El crawl se encola y lo ejecuta el proceso worker (
        <code className="text-fg">npm run worker</code>). La UI irá mostrando el
        progreso.
      </p>
    </form>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        className="input"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded border border-line bg-bg px-3 py-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#4f9dff]"
      />
      {label}
    </label>
  );
}
