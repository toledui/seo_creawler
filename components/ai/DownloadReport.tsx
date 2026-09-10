'use client';

import { useState } from 'react';

const FORMATS = [
  { key: 'pdf', label: 'PDF' },
  { key: 'docx', label: 'Word' },
  { key: 'md', label: 'Markdown' },
] as const;

/**
 * Descarga de un informe guardado.
 *
 * Se hace por fetch y no con un enlace directo para poder mostrar el error
 * si algo falla, en lugar de dejar al navegador con una pestaña en blanco.
 */
export function DownloadReport({
  projectId,
  reportId,
  label = 'Descargar',
}: {
  projectId: string;
  reportId: string;
  label?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: string) {
    setBusy(format);
    setError(null);

    try {
      const res = await fetch(
        `/api/projects/${projectId}/ai/reports/${reportId}/download?format=${format}`,
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'No se pudo generar el archivo');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const filename =
        disposition.match(/filename="(.+?)"/)?.[1] ?? `informe.${format}`;

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{label}:</span>
      {FORMATS.map((format) => (
        <button
          key={format.key}
          className="btn text-xs"
          onClick={() => download(format.key)}
          disabled={busy !== null}
        >
          {busy === format.key ? 'Generando…' : format.label}
        </button>
      ))}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
