'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * Alta de la primera cuenta.
 *
 * El registro público está cerrado: esta pantalla sólo sirve para crear el
 * administrador inicial cuando la instancia todavía no tiene ninguna
 * cuenta. Después, las altas se hacen desde el panel de administración.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/register')
      .then((r) => r.json())
      .then((b) => setOpen(Boolean(b.open)))
      .catch(() => setOpen(false));
  }, []);

  const update =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'No se pudo crear la cuenta');
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  if (open === null) {
    return <div className="card text-sm text-muted">Comprobando…</div>;
  }

  if (!open) {
    return (
      <div className="card space-y-3">
        <h1 className="text-lg font-semibold">Registro cerrado</h1>
        <p className="text-sm text-muted">
          Esta instancia no admite altas públicas. Pide a un administrador que
          te cree una cuenta: recibirás por correo un enlace para establecer tu
          contraseña.
        </p>
        <Link className="link text-sm" href="/login">
          Volver al login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Crear el primer administrador</h1>
        <p className="mt-1 text-sm text-muted">
          No hay ninguna cuenta todavía. Esta será la de administración, desde
          la que se crean las demás.
        </p>
      </div>

      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <div>
        <label className="label" htmlFor="name">
          Nombre
        </label>
        <input id="name" className="input" value={form.name} onChange={update('name')} />
      </div>

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="input"
          value={form.email}
          onChange={update('email')}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          className="input"
          value={form.password}
          onChange={update('password')}
          required
          minLength={8}
        />
        <p className="mt-1 text-xs text-muted">Mínimo 8 caracteres.</p>
      </div>

      <button className="btn btn-primary w-full" disabled={loading}>
        {loading ? 'Creando…' : 'Crear administrador'}
      </button>
    </form>
  );
}
