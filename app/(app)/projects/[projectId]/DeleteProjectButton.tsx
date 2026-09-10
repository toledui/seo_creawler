'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function remove() {
    setLoading(true);
    await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    router.push('/projects');
    router.refresh();
  }

  if (!confirming) {
    return (
      <button className="btn" onClick={() => setConfirming(true)}>
        Eliminar
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">¿Eliminar con todos sus crawls?</span>
      <button className="btn btn-danger" onClick={remove} disabled={loading}>
        {loading ? 'Eliminando…' : 'Sí, eliminar'}
      </button>
      <button className="btn" onClick={() => setConfirming(false)}>
        Cancelar
      </button>
    </div>
  );
}
