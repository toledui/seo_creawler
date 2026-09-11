'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDate, formatNumber } from '@/lib/format';

type GscState = {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
  siteUrl: string | null;
  accountId: string | null;
  accounts: {
    id: string;
    googleEmail: string | null;
    lastError: string | null;
    sites: { siteUrl: string; permissionLevel: string }[];
    sitesError: string | null;
  }[];
  authUrl: string | null;
};

type TrackingState = {
  jobs: {
    id: string;
    date: string;
    status: string;
    keywordsTotal: number;
    keywordsProcessed: number;
    error: string | null;
    scheduledFor: string;
    finishedAt: string | null;
  }[];
  trackedCount: number;
  connected: boolean;
  config: {
    batchSize: number;
    batchDelayMs: number;
    windowStartHour: number;
    gscLagDays: number;
  };
  nextRunAt: string;
};

export function TrackingPanel({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged?: () => void;
}) {
  const [gsc, setGsc] = useState<GscState | null>(null);
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const [gscRes, trackingRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/gsc`, { cache: 'no-store' }),
      fetch(`/api/projects/${projectId}/tracking`, { cache: 'no-store' }),
    ]);

    if (gscRes.ok) setGsc(await gscRes.json());
    if (trackingRes.ok) setTracking(await trackingRes.json());
  }, [projectId]);

  useEffect(() => {
    load();

    // Mensajes que deja el callback de OAuth en la URL.
    const params = new URLSearchParams(window.location.search);
    if (params.get('gsc') === 'connected') {
      setNotice('Search Console conectado');
    } else if (params.get('gsc') === 'error') {
      setError(params.get('message') ?? 'No se pudo conectar Search Console');
    }
  }, [load]);

  async function selectSite(siteUrl: string | null, accountId: string | null) {
    setBusy('site');
    await fetch(`/api/projects/${projectId}/gsc`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteUrl, accountId }),
    });
    setBusy(null);
    load();
  }

  // La autorización es de la cuenta: aquí sólo se desvincula la propiedad
  // de este proyecto. Revocar Google se hace desde Ajustes.
  async function unlinkSite() {
    await selectSite(null, null);
  }

  async function post(action: 'run-now' | 'discover', extra: object = {}) {
    setBusy(action);
    setError(null);
    setNotice(null);

    const res = await fetch(`/api/projects/${projectId}/tracking`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? 'La acción falló');
      return;
    }

    if (action === 'discover') {
      setNotice(
        `Descubiertas ${body.result.created} keywords nuevas y actualizadas ${body.result.updated} (${formatNumber(body.result.scanned)} filas analizadas)`,
      );
      onChanged?.();
    } else {
      setNotice(
        'Tracking encolado: el worker lo procesará en cuanto termine lo que tenga entre manos',
      );
    }

    load();
  }

  const connected = gsc?.connected && Boolean(gsc.siteUrl);
  // Sin cuenta asignada (proyecto antiguo) se mide con la primera.
  const currentAccount =
    gsc?.accounts.find((a) => a.id === gsc.accountId) ?? gsc?.accounts[0] ?? null;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            Search Console{' '}
            <span
              className={`badge ml-1 ${
                connected
                  ? 'bg-ok/15 text-ok'
                  : gsc?.connected
                    ? 'bg-warn/15 text-warn'
                    : 'bg-panel2 text-muted'
              }`}
            >
              {connected
                ? 'conectado'
                : gsc?.connected
                  ? 'falta elegir propiedad'
                  : 'sin conectar'}
            </span>
          </p>
          <p className="text-sm text-muted">
            Es la fuente de las posiciones reales. Sin conexión puedes seguir
            importando keywords por CSV, pero no habrá medición diaria.
          </p>
        </div>

        <div className="flex gap-2">
          {gsc?.configured && !gsc.connected && gsc.authUrl && (
            <a className="btn btn-primary" href={gsc.authUrl}>
              Conectar
            </a>
          )}
          {gsc?.connected && (
            <>
              <button
                className="btn"
                onClick={() => post('discover')}
                disabled={busy !== null || !connected}
                title="Trae de Search Console las consultas por las que ya rankeas"
              >
                {busy === 'discover' ? 'Buscando…' : 'Descubrir keywords'}
              </button>
              <button
                className="btn"
                onClick={() => post('run-now')}
                disabled={busy !== null || !connected}
              >
                {busy === 'run-now' ? 'Encolando…' : 'Medir ahora'}
              </button>
            </>
          )}
          <button className="btn" onClick={() => setOpen((v) => !v)}>
            {open ? 'Ocultar' : 'Detalles'}
          </button>
        </div>
      </div>

      {notice && (
        <p className="rounded border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {gsc && !gsc.configured && (
        <div className="rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
          <p className="mb-1 font-medium">Falta configurar las credenciales</p>
          <p className="text-muted">
            Crea unas credenciales OAuth de tipo &quot;Aplicación web&quot; en Google
            Cloud, habilita la Search Console API y rellena{' '}
            <code className="text-fg">GOOGLE_CLIENT_ID</code> y{' '}
            <code className="text-fg">GOOGLE_CLIENT_SECRET</code> en{' '}
            <code className="text-fg">.env</code>. Añade como URI de redirección
            autorizada:
          </p>
          <code className="mt-1 block break-all text-fg">{gsc.redirectUri}</code>
        </div>
      )}

      {gsc?.connected && !gsc.siteUrl && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">Elige la propiedad que quieres medir:</p>
            {gsc.authUrl && (
              <a className="text-xs text-accent hover:underline" href={gsc.authUrl}>
                + Conectar otra cuenta de Google
              </a>
            )}
          </div>
          {gsc.accounts.map((account) => (
            <div key={account.id} className="space-y-1">
              <p className="text-xs text-muted">
                {account.googleEmail ?? 'Cuenta de Google'}
              </p>
              {account.sitesError && (
                <p className="text-xs text-bad">{account.sitesError}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {account.sites.map((site) => (
                  <button
                    key={site.siteUrl}
                    className="btn text-xs"
                    onClick={() => selectSite(site.siteUrl, account.id)}
                    disabled={busy !== null}
                  >
                    {site.siteUrl}
                  </button>
                ))}
                {account.sites.length === 0 && !account.sitesError && (
                  <p className="text-xs text-muted">
                    Esta cuenta no tiene propiedades verificadas.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-line pt-3 text-xs">
          {gsc?.siteUrl && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Propiedad: <code className="text-fg">{gsc.siteUrl}</code>
              </span>
              {currentAccount?.googleEmail && (
                <span className="text-muted">Cuenta: {currentAccount.googleEmail}</span>
              )}
              <button
                className="text-bad hover:underline"
                onClick={unlinkSite}
                disabled={busy !== null}
              >
                Cambiar propiedad
              </button>
            </div>
          )}

          {gsc?.siteUrl && currentAccount?.lastError && (
            <p className="text-bad">Último error: {currentAccount.lastError}</p>
          )}

          {tracking && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Info
                  label="Keywords en seguimiento"
                  value={formatNumber(tracking.trackedCount)}
                />
                <Info
                  label="Próxima ejecución"
                  value={formatDate(tracking.nextRunAt)}
                />
                <Info
                  label="Lote"
                  value={`${tracking.config.batchSize} · ${tracking.config.batchDelayMs}ms`}
                />
                <Info
                  label="Retraso de datos"
                  value={`${tracking.config.gscLagDays} días`}
                />
              </div>

              <p className="text-muted">
                Se ejecuta un job por proyecto y día, no uno por keyword: Search
                Console devuelve hasta 25.000 consultas en una sola llamada. La
                hora se escalona según el proyecto y las escrituras van por
                lotes con pausa, así que el tracking no compite con los crawls.
              </p>

              {tracking.jobs.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Día</th>
                        <th>Estado</th>
                        <th className="text-right">Procesadas</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tracking.jobs.map((job) => (
                        <tr key={job.id}>
                          <td className="whitespace-nowrap">
                            {new Date(job.date).toLocaleDateString('es-ES')}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                job.status === 'COMPLETED'
                                  ? 'bg-ok/15 text-ok'
                                  : job.status === 'FAILED'
                                    ? 'bg-bad/20 text-bad'
                                    : job.status === 'RUNNING'
                                      ? 'bg-accent/20 text-accent'
                                      : 'bg-panel2 text-muted'
                              }`}
                            >
                              {job.status}
                            </span>
                          </td>
                          <td className="text-right tabular-nums">
                            {job.keywordsProcessed}/{job.keywordsTotal}
                          </td>
                          <td className="text-muted">{job.error ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
