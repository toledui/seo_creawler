'use client';

import { useState } from 'react';

/**
 * Botón de "enviar por correo" para cualquier informe.
 *
 * El endpoint recibe un `{ to }` opcional: si no se indica dirección se
 * usa la de la cuenta (o la alternativa configurada en Ajustes). El
 * informe viaja siempre en PDF adjunto, generado en el servidor.
 */
export function EmailReport({
  endpoint,
  label = 'Enviar por correo',
  compact = false,
}: {
  /** POST que dispara el envío. */
  endpoint: string;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const address = to.trim();

    setSending(true);
    setError(null);
    setSentTo(null);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(address ? { to: address } : {}),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'No se pudo enviar el informe');

      setSentTo(address || 'la dirección de tu cuenta');
      setOpen(false);
      setTo('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const size = compact ? 'text-xs' : '';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open && (
        <input
          className="input w-56 py-1 text-xs"
          type="email"
          placeholder="Otra dirección (opcional)"
          value={to}
          autoFocus
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !sending) send();
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      )}

      <button
        className={`btn ${size}`}
        onClick={() => (open ? send() : (setOpen(true), setError(null)))}
        disabled={sending}
        title="Envía el informe en PDF por correo"
      >
        {sending ? 'Enviando…' : open ? 'Enviar ahora' : label}
      </button>

      {open && !sending && (
        <button
          className={`btn btn-ghost ${size}`}
          onClick={() => {
            setOpen(false);
            setTo('');
          }}
        >
          Cancelar
        </button>
      )}

      {sentTo && <span className="text-xs text-ok">Enviado a {sentTo}.</span>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
