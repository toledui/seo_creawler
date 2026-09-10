'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDate } from '@/lib/format';

type Data = {
  user: { id: string; email: string; name: string | null; role: string };
  ai: {
    configured: boolean;
    hasOwnKey: boolean;
    fromEnvFallback: boolean;
    keyHint: string | null;
    model: string;
    baseUrl: string;
  };
  notifications: {
    emailOnCrawlComplete: boolean;
    emailOnAiReport: boolean;
    notifyEmail: string | null;
    smtpConfigured: boolean;
    reportsEnabled: boolean;
  };
  gsc: {
    configured: boolean;
    connected: boolean;
    googleEmail: string | null;
    lastError: string | null;
    connectedAt: string | null;
    authUrl: string | null;
    sites: { siteUrl: string; permissionLevel: string }[];
    sitesError: string | null;
    projects: { id: string; name: string; domain: string; gscSiteUrl: string | null }[];
  };
};

export function AccountSettings() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/account/settings', { cache: 'no-store' });
    if (!res.ok) return;
    const body: Data = await res.json();
    setData(body);
    setAiModel(body.ai.model);
  }, []);

  useEffect(() => {
    load();

    const params = new URLSearchParams(window.location.search);
    if (params.get('gsc') === 'connected') setNotice('Search Console conectado');
    else if (params.get('gsc') === 'error') {
      setError(params.get('message') ?? 'No se pudo conectar Search Console');
    }
  }, [load]);

  async function patch(payload: object, message: string) {
    setBusy('patch');
    setError(null);
    setNotice(null);

    const res = await fetch('/api/account/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    setBusy(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'No se pudo guardar');
      return;
    }

    setNotice(message);
    setAiKey('');
    load();
  }

  async function action(name: 'test-ai' | 'disconnect-gsc') {
    setBusy(name);
    setError(null);
    setNotice(null);

    const res = await fetch('/api/account/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: name }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? 'La acción falló');
      return;
    }

    setNotice(body.message ?? 'Hecho');
    load();
  }

  async function setProjectSite(projectId: string, siteUrl: string) {
    setBusy(projectId);
    await fetch(`/api/projects/${projectId}/gsc`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteUrl: siteUrl || null }),
    });
    setBusy(null);
    load();
  }

  if (!data) return <div className="card text-sm text-muted">Cargando…</div>;

  const { ai, notifications, gsc } = data;

  return (
    <div className="space-y-4">
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

      {/* ---------------------------------------------------------- IA */}
      <div className="card space-y-3">
        <div>
          <p className="font-medium">
            Inteligencia artificial{' '}
            <span
              className={`badge ml-1 ${
                ai.hasOwnKey
                  ? 'bg-ok/15 text-ok'
                  : ai.configured
                    ? 'bg-warn/15 text-warn'
                    : 'bg-panel2 text-muted'
              }`}
            >
              {ai.hasOwnKey
                ? 'clave propia'
                : ai.configured
                  ? 'usando la del servidor'
                  : 'sin configurar'}
            </span>
          </p>
          <p className="text-sm text-muted">
            La clave es tuya y el consumo se factura a tu cuenta de DeepSeek.
            Se guarda cifrada y no se muestra nunca completa.
          </p>
        </div>

        {ai.fromEnvFallback && (
          <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            Ahora mismo se está usando la clave del archivo <code>.env</code> del
            servidor. Pon la tuya para que el gasto salga de tu propia cuenta.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <label className="label">
              Clave de API{ai.hasOwnKey ? ` (guardada: ${ai.keyHint})` : ''}
            </label>
            <input
              type="password"
              className="input"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder={ai.hasOwnKey ? 'Dejar vacío para no cambiar' : 'sk-…'}
            />
          </div>

          <div>
            <label className="label">Modelo</label>
            <input
              className="input w-44"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="deepseek-chat"
            />
          </div>

          <button
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() =>
              patch(
                {
                  ...(aiKey ? { deepseekApiKey: aiKey } : {}),
                  deepseekModel: aiModel || null,
                },
                'Configuración de IA guardada',
              )
            }
          >
            Guardar
          </button>

          <button
            className="btn"
            disabled={busy !== null || !ai.configured}
            onClick={() => action('test-ai')}
          >
            {busy === 'test-ai' ? 'Probando…' : 'Probar clave'}
          </button>

          {ai.hasOwnKey && (
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() => patch({ deepseekApiKey: '' }, 'Clave eliminada')}
            >
              Quitar clave
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ Search Console */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">
              Search Console{' '}
              <span
                className={`badge ml-1 ${gsc.connected ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted'}`}
              >
                {gsc.connected ? 'conectado' : 'sin conectar'}
              </span>
            </p>
            <p className="text-sm text-muted">
              Conecta tu Google una vez y elige después qué propiedad mide cada
              proyecto.
              {gsc.googleEmail && ` Conectado como ${gsc.googleEmail}.`}
            </p>
          </div>

          <div className="flex gap-2">
            {!gsc.connected && gsc.authUrl && (
              <a className="btn btn-primary" href={gsc.authUrl}>
                Conectar con Google
              </a>
            )}
            {gsc.connected && (
              <>
                {gsc.authUrl && (
                  <a className="btn" href={gsc.authUrl}>
                    Reconectar
                  </a>
                )}
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => action('disconnect-gsc')}
                >
                  Desconectar
                </button>
              </>
            )}
          </div>
        </div>

        {!gsc.configured && (
          <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            El administrador todavía no ha registrado las credenciales OAuth de
            Google, así que no se puede conectar.
          </p>
        )}

        {gsc.lastError && (
          <p className="text-xs text-bad">Último error: {gsc.lastError}</p>
        )}
        {gsc.sitesError && (
          <p className="text-xs text-bad">{gsc.sitesError}</p>
        )}

        {gsc.connected && gsc.projects.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Propiedad de Search Console</th>
                </tr>
              </thead>
              <tbody>
                {gsc.projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <div className="font-medium">{project.name}</div>
                      <div className="text-xs text-muted">{project.domain}</div>
                    </td>
                    <td>
                      <select
                        className="input w-auto py-1 text-xs"
                        value={project.gscSiteUrl ?? ''}
                        disabled={busy === project.id}
                        onChange={(e) => setProjectSite(project.id, e.target.value)}
                      >
                        <option value="">Sin asignar</option>
                        {gsc.sites.map((site) => (
                          <option key={site.siteUrl} value={site.siteUrl}>
                            {site.siteUrl}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {gsc.connectedAt && (
          <p className="text-[11px] text-muted">
            Conectado el {formatDate(gsc.connectedAt)}
          </p>
        )}
      </div>

      {/* --------------------------------------------------- Notificaciones */}
      <div className="card space-y-3">
        <div>
          <p className="font-medium">Informes por correo</p>
          <p className="text-sm text-muted">
            Recibe un resumen cuando termine un crawl o cuando se genere una
            auditoría con IA.
          </p>
        </div>

        {!notifications.smtpConfigured && (
          <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            No hay servidor de correo configurado en la instancia. Pídeselo al
            administrador.
          </p>
        )}

        {notifications.smtpConfigured && !notifications.reportsEnabled && (
          <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            El administrador tiene desactivado el envío de informes.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Toggle
            label="Resumen al terminar un crawl"
            checked={notifications.emailOnCrawlComplete}
            disabled={busy !== null}
            onChange={(v) =>
              patch({ emailOnCrawlComplete: v }, 'Preferencia guardada')
            }
          />
          <Toggle
            label="Auditoría de IA al generarse"
            checked={notifications.emailOnAiReport}
            disabled={busy !== null}
            onChange={(v) => patch({ emailOnAiReport: v }, 'Preferencia guardada')}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="label">
              Enviar a (vacío = {data.user.email})
            </label>
            <input
              type="email"
              className="input"
              defaultValue={notifications.notifyEmail ?? ''}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if ((notifications.notifyEmail ?? '') === value) return;
                patch({ notifyEmail: value || null }, 'Dirección actualizada');
              }}
              placeholder={data.user.email}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded border border-line bg-bg px-3 py-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#4f9dff]"
      />
      {label}
    </label>
  );
}
