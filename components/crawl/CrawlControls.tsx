'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Action = 'start' | 'pause' | 'resume' | 'cancel';

export function CrawlControls({
  crawlId,
  status,
}: {
  crawlId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(action: Action) {
    setBusy(action);
    setError(null);

    const res = await fetch(`/api/crawls/${crawlId}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'La acción falló');
    }

    setBusy(null);
    router.refresh();
  }

  const active = status === 'RUNNING' || status === 'QUEUED';
  const resumable = ['PAUSED', 'CANCELLED', 'FAILED', 'PENDING', 'COMPLETED'].includes(
    status,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {status === 'RUNNING' && (
          <button
            className="btn"
            onClick={() => send('pause')}
            disabled={busy !== null}
          >
            {busy === 'pause' ? 'Pausando…' : 'Pausar'}
          </button>
        )}

        {resumable && (
          <button
            className="btn"
            onClick={() => send(status === 'PAUSED' ? 'resume' : 'start')}
            disabled={busy !== null}
          >
            {busy === 'resume' || busy === 'start'
              ? 'Encolando…'
              : status === 'PAUSED'
                ? 'Reanudar'
                : status === 'COMPLETED'
                  ? 'Re-rastrear'
                  : 'Iniciar'}
          </button>
        )}

        {active && (
          <button
            className="btn btn-danger"
            onClick={() => send('cancel')}
            disabled={busy !== null}
          >
            {busy === 'cancel' ? 'Cancelando…' : 'Cancelar'}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
