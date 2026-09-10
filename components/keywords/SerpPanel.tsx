'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDate, formatNumber } from '@/lib/format';

type SerpState = {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  settings: {
    serpTrackingEnabled: boolean;
    serpLocationCode: number;
    serpLanguageCode: string;
    serpDevice: string;
    serpCountry: string;
    serpTarget: string | null;
    resolvedTarget: string;
  };
  trackedCount: number;
  costPerCheck: number;
  estimatedDailyCost: number;
  estimatedMonthlyCost: number;
  spend: { days: number; checks: number; costUsd: number };
  country: string;
  locations: { code: number; name: string }[];
  locationsTotal: number;
  languages: { code: string; name: string }[];
  referenceError: string | null;
};

/**
 * Países disponibles.
 *
 * Serplify sirve las ubicaciones por país porque el listado global viene
 * recortado (España y México ni siquiera aparecían en él).
 */
const COUNTRIES = [
  { iso: 'ES', name: 'España' },
  { iso: 'MX', name: 'México' },
  { iso: 'AR', name: 'Argentina' },
  { iso: 'CO', name: 'Colombia' },
  { iso: 'CL', name: 'Chile' },
  { iso: 'PE', name: 'Perú' },
  { iso: 'US', name: 'Estados Unidos' },
  { iso: 'GB', name: 'Reino Unido' },
  { iso: 'PT', name: 'Portugal' },
  { iso: 'FR', name: 'Francia' },
  { iso: 'DE', name: 'Alemania' },
  { iso: 'IT', name: 'Italia' },
  { iso: 'BR', name: 'Brasil' },
  { iso: 'CA', name: 'Canadá' },
];

/**
 * Medición de posiciones reales con Serplify.
 *
 * Complementa a Search Console: GSC dice cuántos clics tienes y su
 * posición media del periodo; esto dice en qué puesto exacto sales hoy y
 * quién está por encima, también en keywords donde aún no apareces.
 */
export function SerpPanel({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged?: () => void;
}) {
  const [state, setState] = useState<SerpState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  /**
   * `country` implica pedir el listado de ubicaciones; `refs` lo pide para
   * el país ya guardado. Sin ninguno de los dos la respuesta es inmediata,
   * porque no toca la API de Serplify.
   */
  const load = useCallback(
    async (options: { country?: string; refs?: boolean } = {}) => {
      const query = new URLSearchParams();
      if (options.country) query.set('country', options.country);
      else if (options.refs) query.set('refs', '1');

      const suffix = query.toString() ? `?${query}` : '';
      const res = await fetch(`/api/projects/${projectId}/serp${suffix}`, {
        cache: 'no-store',
      });
      if (res.ok) setState(await res.json());
    },
    [projectId],
  );

  useEffect(() => {
    load();
  }, [load]);

  /** Los listados sólo hacen falta al abrir los ajustes. */
  function toggleSettings() {
    const next = !open;
    setOpen(next);
    if (next && state && state.languages.length === 0) load({ refs: true });
  }

  /**
   * Cambiar de país cambia el listado entero de ubicaciones, así que el
   * código guardado deja de ser válido: se pasa al nivel país, que es la
   * primera entrada del listado ordenado.
   */
  async function changeCountry(iso: string) {
    setBusy('patch');
    setError(null);
    setNotice(null);

    const res = await fetch(
      `/api/projects/${projectId}/serp?country=${encodeURIComponent(iso)}`,
      { cache: 'no-store' },
    );

    if (!res.ok) {
      setBusy(null);
      setError('No se pudieron cargar las ubicaciones de ese país');
      return;
    }

    const next: SerpState = await res.json();

    // Pintamos ya el país nuevo: esta respuesta trae las ubicaciones del
    // país elegido pero los ajustes todavía sin guardar, y sin esto la
    // tarjeta enseña "España" con el mercado de México hasta que vuelve
    // el PATCH.
    setState({ ...next, settings: { ...next.settings, serpCountry: iso } });
    const fallback = next.locations[0]?.code;
    const stillValid = next.locations.some(
      (l) => l.code === next.settings.serpLocationCode,
    );

    setBusy(null);
    await patch(
      {
        serpCountry: iso,
        ...(stillValid || !fallback ? {} : { serpLocationCode: fallback }),
      },
      'País actualizado',
      iso,
    );
  }

  async function patch(payload: object, message: string, country?: string) {
    setBusy('patch');
    setError(null);
    setNotice(null);

    const res = await fetch(`/api/projects/${projectId}/serp`, {
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
    load({ country: country ?? (open ? state?.settings.serpCountry : undefined) });
  }

  async function checkNow() {
    if (!state) return;

    const cost = state.estimatedDailyCost.toFixed(2);
    if (
      !confirm(
        `Se van a medir ${state.trackedCount} keywords en Google. Coste estimado: $${cost}. ¿Continuar?`,
      )
    ) {
      return;
    }

    setBusy('check');
    setError(null);
    setNotice(null);

    const res = await fetch(`/api/projects/${projectId}/serp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'check-now' }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? 'La medición falló');
      return;
    }

    const result = body.result;
    setNotice(
      `${result.checked} keywords medidas, ${result.found} posicionadas. Coste: $${result.costUsd.toFixed(3)}.` +
        (result.failed ? ` ${result.failed} con error.` : ''),
    );
    load();
    onChanged?.();
  }

  // Un esqueleto en lugar de `null`: si no, la página salta cuando la
  // tarjeta aparece de golpe.
  if (!state) {
    return (
      <div className="card">
        <div className="h-4 w-52 animate-pulse rounded bg-panel2" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-panel2" />
      </div>
    );
  }

  if (!state.configured) {
    return (
      <div className="card">
        <p className="font-medium">Posición real en Google</p>
        <p className="mt-1 text-sm text-muted">
          Serplify no está configurado en esta instancia. Pídeselo al
          administrador para medir posiciones exactas, también en keywords
          donde todavía no apareces.
        </p>
      </div>
    );
  }

  const { settings } = state;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            Posición real en Google{' '}
            <span
              className={`badge ml-1 ${
                settings.serpTrackingEnabled && state.enabled
                  ? 'bg-ok/15 text-ok'
                  : 'bg-panel2 text-muted'
              }`}
            >
              {!state.enabled
                ? 'desactivado globalmente'
                : settings.serpTrackingEnabled
                  ? 'medición diaria activa'
                  : 'sólo bajo demanda'}
            </span>
          </p>
          <p className="text-sm text-muted">
            Serplify consulta el SERP y devuelve tu puesto exacto y quién está
            por encima. A diferencia de Search Console, también mide keywords
            donde aún no rankeas. Siguiendo{' '}
            <code className="text-fg">{settings.resolvedTarget}</code>.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            onClick={checkNow}
            disabled={busy !== null || !state.enabled || state.trackedCount === 0}
          >
            {busy === 'check' ? 'Midiendo…' : 'Medir ahora'}
          </button>
          <button className="btn" onClick={toggleSettings}>
            {open ? 'Ocultar' : 'Ajustes'}
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

      {busy === 'check' && (
        <p className="text-sm text-muted">
          Midiendo {state.trackedCount} keywords, una por una para no saturar…
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Info label="Keywords en seguimiento" value={formatNumber(state.trackedCount)} />
        <Info
          label="Coste por medición completa"
          value={`$${state.estimatedDailyCost.toFixed(2)}`}
        />
        <Info
          label="Si se mide a diario"
          value={`~$${state.estimatedMonthlyCost.toFixed(2)}/mes`}
        />
        <Info
          label={`Gastado (${state.spend.days} días)`}
          value={`$${state.spend.costUsd.toFixed(2)} · ${formatNumber(state.spend.checks)} consultas`}
        />
      </div>

      {open && (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">País</label>
              <select
                className="input w-auto"
                value={settings.serpCountry}
                disabled={busy !== null}
                onChange={(e) => changeCountry(e.target.value)}
              >
                {!COUNTRIES.some((c) => c.iso === settings.serpCountry) && (
                  <option value={settings.serpCountry}>
                    {settings.serpCountry}
                  </option>
                )}
                {COUNTRIES.map((country) => (
                  <option key={country.iso} value={country.iso}>
                    {country.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Mercado</label>
              <select
                className="input w-auto"
                value={settings.serpLocationCode}
                disabled={busy !== null}
                onChange={(e) =>
                  patch(
                    { serpLocationCode: Number(e.target.value) },
                    'Mercado actualizado',
                  )
                }
              >
                {state.locations.length === 0 && (
                  <option value={settings.serpLocationCode}>
                    {settings.serpLocationCode}
                  </option>
                )}
                {state.locations.map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Idioma</label>
              <select
                className="input w-auto"
                value={settings.serpLanguageCode}
                disabled={busy !== null}
                onChange={(e) =>
                  patch(
                    { serpLanguageCode: e.target.value },
                    'Idioma actualizado',
                  )
                }
              >
                {state.languages.length === 0 && (
                  <option value={settings.serpLanguageCode}>
                    {settings.serpLanguageCode}
                  </option>
                )}
                {state.languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Dispositivo</label>
              <select
                className="input w-auto"
                value={settings.serpDevice}
                disabled={busy !== null}
                onChange={(e) =>
                  patch({ serpDevice: e.target.value }, 'Dispositivo actualizado')
                }
              >
                <option value="desktop">Escritorio</option>
                <option value="mobile">Móvil</option>
              </select>
            </div>

            <div>
              <label className="label">Dominio a seguir</label>
              <input
                className="input w-52"
                defaultValue={settings.serpTarget ?? ''}
                placeholder={settings.resolvedTarget}
                disabled={busy !== null}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if ((settings.serpTarget ?? '') === value) return;
                  patch({ serpTarget: value || null }, 'Dominio actualizado');
                }}
              />
            </div>
          </div>

          {state.referenceError && (
            <p className="text-xs text-bad">
              No se pudo cargar el listado de mercados: {state.referenceError}
            </p>
          )}

          {state.locationsTotal > state.locations.length && (
            <p className="text-xs text-muted">
              Mostrando las primeras {state.locations.length} de{' '}
              {formatNumber(state.locationsTotal)} ubicaciones de{' '}
              {settings.serpCountry}. La primera es el país entero, que es lo
              habitual salvo que midas un negocio local.
            </p>
          )}

          <label className="flex cursor-pointer items-center gap-2 rounded border border-line bg-bg px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#4f9dff]"
              checked={settings.serpTrackingEnabled}
              disabled={busy !== null}
              onChange={(e) =>
                patch(
                  { serpTrackingEnabled: e.target.checked },
                  e.target.checked
                    ? 'Medición diaria activada'
                    : 'Medición diaria desactivada',
                )
              }
            />
            Medir automáticamente cada día junto al tracking de Search Console
          </label>

          <p className="text-xs text-muted">
            Con la medición diaria activa se gastan ~$
            {state.estimatedMonthlyCost.toFixed(2)} al mes con las{' '}
            {state.trackedCount} keywords actuales. Si prefieres controlarlo,
            déjalo apagado y usa &quot;Medir ahora&quot; cuando lo necesites.
          </p>
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
