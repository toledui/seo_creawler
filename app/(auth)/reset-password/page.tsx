'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

type TokenInfo = {
  purpose: 'INVITE' | 'RESET';
  email: string;
  name: string | null;
};

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid('Falta el token del enlace');
      return;
    }

    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) setInvalid(body.error ?? 'El enlace no es válido');
        else setInfo(body);
      })
      .catch(() => setInvalid('No se pudo comprobar el enlace'));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'No se pudo guardar la contraseña');
      setLoading(false);
      return;
    }

    router.push('/login');
  }

  if (invalid) {
    return (
      <div className="card space-y-3">
        <h1 className="text-lg font-semibold">Enlace no válido</h1>
        <p className="text-sm text-muted">{invalid}</p>
        <p className="text-sm text-muted">
          Pide uno nuevo desde &quot;¿Olvidaste tu contraseña?&quot; o al
          administrador.
        </p>
        <Link className="link text-sm" href="/login">
          Volver al login
        </Link>
      </div>
    );
  }

  if (!info) return <div className="card text-sm text-muted">Comprobando enlace…</div>;

  const isInvite = info.purpose === 'INVITE';

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <h1 className="text-lg font-semibold">
          {isInvite ? 'Bienvenido a SEO Crawler' : 'Nueva contraseña'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {isInvite
            ? 'Elige una contraseña para activar tu cuenta.'
            : 'Elige una contraseña nueva para tu cuenta.'}{' '}
          <span className="text-fg">{info.email}</span>
        </p>
      </div>

      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <div>
        <label className="label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-muted">Mínimo 8 caracteres.</p>
      </div>

      <div>
        <label className="label" htmlFor="confirm">
          Repite la contraseña
        </label>
        <input
          id="confirm"
          type="password"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          required
          autoComplete="new-password"
        />
      </div>

      <button className="btn btn-primary w-full" disabled={loading}>
        {loading
          ? 'Guardando…'
          : isInvite
            ? 'Activar mi cuenta'
            : 'Cambiar contraseña'}
      </button>

      <Link className="link block text-center text-xs" href="/login">
        Volver al login
      </Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="card text-sm text-muted">Cargando…</div>}>
      <ResetForm />
    </Suspense>
  );
}
