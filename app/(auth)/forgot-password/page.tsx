'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const body = await res.json().catch(() => ({}));
    setResetUrl(body.resetUrl ?? null);
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="card space-y-3">
        <h1 className="text-lg font-semibold">Revisa tu correo</h1>
        <p className="text-sm text-muted">
          Si el email existe, se ha generado un enlace de recuperación válido
          durante 1 hora.
        </p>
        {resetUrl && (
          <div className="rounded border border-warn/40 bg-warn/10 p-3 text-xs">
            <p className="mb-1 font-medium text-warn">
              MVP sin servicio de email
            </p>
            <p className="mb-2 text-muted">
              El enlace se muestra aquí directamente. En producción se enviaría
              por correo.
            </p>
            <Link className="link break-all" href={resetUrl}>
              {resetUrl}
            </Link>
          </div>
        )}
        <Link className="link text-sm" href="/login">
          Volver al login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h1 className="text-lg font-semibold">Recuperar contraseña</h1>
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <button className="btn btn-primary w-full" disabled={loading}>
        {loading ? 'Generando…' : 'Enviar enlace'}
      </button>
      <Link className="link block text-center text-xs" href="/login">
        Volver al login
      </Link>
    </form>
  );
}
