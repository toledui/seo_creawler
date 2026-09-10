'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, domain }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? 'No se pudo crear el proyecto');
      setLoading(false);
      return;
    }

    router.push(`/projects/${body.project.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link href="/projects" className="link text-sm">
        ← Proyectos
      </Link>

      <form onSubmit={onSubmit} className="card space-y-4">
        <h1 className="text-lg font-semibold">Nuevo proyecto</h1>

        {error && (
          <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}

        <div>
          <label className="label" htmlFor="name">
            Nombre
          </label>
          <input
            id="name"
            className="input"
            placeholder="Tienda ACME"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="domain">
            Dominio
          </label>
          <input
            id="domain"
            className="input"
            placeholder="https://acme.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-muted">
            Si omites el protocolo se asumirá https.
          </p>
        </div>

        <button className="btn btn-primary w-full" disabled={loading}>
          {loading ? 'Creando…' : 'Crear proyecto'}
        </button>
      </form>
    </div>
  );
}
