'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDate } from '@/lib/format';

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'MEMBER';
  isActive: boolean;
  pending: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  projects: number;
  hasAiKey: boolean;
  gscEmail: string | null;
};

type Settings = {
  smtp: {
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    passwordSet: boolean;
    passwordHint: string | null;
    from: string;
    configured: boolean;
  };
  google: {
    clientId: string | null;
    clientSecretSet: boolean;
    clientSecretHint: string | null;
    configured: boolean;
    redirectUri: string;
  };
  email: { reportsEnabled: boolean };
  serplify: {
    apiKeySet: boolean;
    apiKeyHint: string | null;
    baseUrl: string;
    enabled: boolean;
    configured: boolean;
  };
  appUrl: string;
};

type Tab = 'users' | 'smtp' | 'google' | 'serplify';

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [usersRes, settingsRes] = await Promise.all([
      fetch('/api/admin/users', { cache: 'no-store' }),
      fetch('/api/admin/settings', { cache: 'no-store' }),
    ]);

    if (usersRes.ok) setUsers((await usersRes.json()).users ?? []);
    if (settingsRes.ok) setSettings(await settingsRes.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-line">
        {(
          [
            ['users', `Cuentas (${users.length})`],
            ['smtp', 'Correo saliente'],
            ['google', 'Google / Search Console'],
            ['serplify', 'Serplify'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm transition ${
              tab === key
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
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

      {tab === 'users' && (
        <UsersTab
          users={users}
          reload={load}
          setNotice={setNotice}
          setError={setError}
          busy={busy}
          setBusy={setBusy}
          smtpConfigured={settings?.smtp.configured ?? false}
        />
      )}

      {tab === 'smtp' && settings && (
        <SmtpTab
          settings={settings}
          reload={load}
          setNotice={setNotice}
          setError={setError}
        />
      )}

      {tab === 'google' && settings && (
        <GoogleTab
          settings={settings}
          reload={load}
          setNotice={setNotice}
          setError={setError}
        />
      )}

      {tab === 'serplify' && settings && (
        <SerplifyTab
          settings={settings}
          reload={load}
          setNotice={setNotice}
          setError={setError}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Users

function UsersTab({
  users,
  reload,
  setNotice,
  setError,
  busy,
  setBusy,
  smtpConfigured,
}: {
  users: AdminUser[];
  reload: () => Promise<void>;
  setNotice: (v: string | null) => void;
  setError: (v: string | null) => void;
  busy: string | null;
  setBusy: (v: string | null) => void;
  smtpConfigured: boolean;
}) {
  const [form, setForm] = useState({ email: '', name: '', role: 'MEMBER' });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    setError(null);
    setNotice(null);
    setInviteUrl(null);

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? 'No se pudo crear la cuenta');
      return;
    }

    setNotice(
      body.delivered
        ? `Cuenta creada. Se envió a ${form.email} el enlace para establecer su contraseña.`
        : 'Cuenta creada, pero no se pudo enviar el correo. Pásale el enlace a mano.',
    );
    if (body.inviteUrl) setInviteUrl(body.inviteUrl);

    setForm({ email: '', name: '', role: 'MEMBER' });
    reload();
  }

  async function act(userId: string, payload: object, label: string) {
    setBusy(userId);
    setError(null);
    setNotice(null);
    setInviteUrl(null);

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? 'La acción falló');
      return;
    }

    if (body.url) setInviteUrl(body.url);
    setNotice(
      body.delivered === false && body.url
        ? 'No hay SMTP: copia el enlace y pásalo a mano.'
        : label,
    );
    reload();
  }

  async function remove(user: AdminUser) {
    if (
      !confirm(
        `¿Eliminar la cuenta ${user.email}? Se borrarán sus ${user.projects} proyecto(s) y todos sus datos.`,
      )
    ) {
      return;
    }

    setBusy(user.id);
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? 'No se pudo eliminar');
      return;
    }

    setNotice('Cuenta eliminada');
    reload();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={createUser} className="card space-y-3">
        <div>
          <p className="font-medium">Crear cuenta</p>
          <p className="text-sm text-muted">
            El registro público está cerrado. Se envía por correo un enlace de
            un solo uso para que la persona elija su contraseña; nunca se
            manda una contraseña en claro.
          </p>
        </div>

        {!smtpConfigured && (
          <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            No hay SMTP configurado: el enlace se mostrará aquí para que lo
            pases a mano.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>

          <div className="min-w-[160px] flex-1">
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Rol</label>
            <select
              className="input w-auto"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              <option value="MEMBER">Miembro</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>

          <button className="btn btn-primary" disabled={busy === 'create'}>
            {busy === 'create' ? 'Creando…' : 'Crear y enviar invitación'}
          </button>
        </div>

        {inviteUrl && (
          <div className="rounded border border-warn/40 bg-warn/10 p-3 text-xs">
            <p className="mb-1 font-medium text-warn">Enlace de acceso</p>
            <code className="break-all text-fg">{inviteUrl}</code>
          </div>
        )}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Rol</th>
              <th>Estado</th>
              <th className="text-right">Proyectos</th>
              <th>IA</th>
              <th>Search Console</th>
              <th>Último acceso</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.isActive ? '' : 'opacity-50'}>
                <td>
                  <div className="font-medium">{user.name ?? '—'}</div>
                  <div className="text-xs text-muted">{user.email}</div>
                </td>
                <td>
                  <select
                    className="input w-auto py-1 text-xs"
                    value={user.role}
                    onChange={(e) =>
                      act(user.id, { role: e.target.value }, 'Rol actualizado')
                    }
                    disabled={busy === user.id}
                  >
                    <option value="MEMBER">Miembro</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </td>
                <td>
                  {user.pending ? (
                    <span className="badge bg-warn/15 text-warn">sin activar</span>
                  ) : user.isActive ? (
                    <span className="badge bg-ok/15 text-ok">activa</span>
                  ) : (
                    <span className="badge bg-panel2 text-muted">desactivada</span>
                  )}
                </td>
                <td className="text-right tabular-nums">{user.projects}</td>
                <td>
                  <span
                    className={`badge ${user.hasAiKey ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted'}`}
                  >
                    {user.hasAiKey ? 'clave propia' : 'sin clave'}
                  </span>
                </td>
                <td className="text-xs text-muted">{user.gscEmail ?? '—'}</td>
                <td className="whitespace-nowrap text-xs text-muted">
                  {user.lastLoginAt ? formatDate(user.lastLoginAt) : 'nunca'}
                </td>
                <td className="whitespace-nowrap text-right text-xs">
                  <button
                    className="link"
                    disabled={busy === user.id}
                    onClick={() =>
                      act(
                        user.id,
                        { action: user.pending ? 'resend-invite' : 'send-reset' },
                        user.pending
                          ? 'Invitación reenviada'
                          : 'Enlace de recuperación enviado',
                      )
                    }
                  >
                    {user.pending ? 'Reenviar' : 'Recuperar'}
                  </button>
                  <button
                    className="ml-2 link"
                    disabled={busy === user.id}
                    onClick={() =>
                      act(
                        user.id,
                        { isActive: !user.isActive },
                        user.isActive ? 'Cuenta desactivada' : 'Cuenta activada',
                      )
                    }
                  >
                    {user.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    className="ml-2 text-bad hover:underline"
                    disabled={busy === user.id}
                    onClick={() => remove(user)}
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- SMTP

function SmtpTab({
  settings,
  reload,
  setNotice,
  setError,
}: {
  settings: Settings;
  reload: () => Promise<void>;
  setNotice: (v: string | null) => void;
  setError: (v: string | null) => void;
}) {
  const [form, setForm] = useState({
    smtpHost: settings.smtp.host ?? '',
    smtpPort: String(settings.smtp.port),
    smtpSecure: settings.smtp.secure,
    smtpUser: settings.smtp.user ?? '',
    smtpPassword: '',
    smtpFrom: settings.smtp.from,
    appUrl: settings.appUrl,
    emailReportsEnabled: settings.email.reportsEnabled,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setNotice(null);

    const payload: Record<string, unknown> = { ...form };
    // Vacío = no tocar la contraseña guardada.
    if (!form.smtpPassword) delete payload.smtpPassword;

    const res = await fetch('/api/admin/settings', {
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

    setNotice('Configuración guardada');
    setForm((f) => ({ ...f, smtpPassword: '' }));
    reload();
  }

  async function action(name: 'test-smtp' | 'send-test-email') {
    setBusy(name);
    setError(null);
    setNotice(null);

    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: name }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) setError(body.error ?? 'La prueba falló');
    else setNotice(body.message ?? 'Correcto');
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <div>
        <p className="font-medium">
          Correo saliente{' '}
          <span
            className={`badge ml-1 ${settings.smtp.configured ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted'}`}
          >
            {settings.smtp.configured ? 'configurado' : 'sin configurar'}
          </span>
        </p>
        <p className="text-sm text-muted">
          Se usa para las invitaciones, la recuperación de contraseña y el
          envío de informes.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Host">
          <input
            className="input"
            value={form.smtpHost}
            onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))}
            placeholder="smtp.tuproveedor.com"
          />
        </Field>

        <Field label="Puerto">
          <input
            className="input"
            value={form.smtpPort}
            onChange={(e) => setForm((f) => ({ ...f, smtpPort: e.target.value }))}
          />
        </Field>

        <Field label="Usuario">
          <input
            className="input"
            value={form.smtpUser}
            onChange={(e) => setForm((f) => ({ ...f, smtpUser: e.target.value }))}
          />
        </Field>

        <Field
          label={`Contraseña${settings.smtp.passwordSet ? ` (guardada: ${settings.smtp.passwordHint})` : ''}`}
        >
          <input
            type="password"
            className="input"
            value={form.smtpPassword}
            onChange={(e) =>
              setForm((f) => ({ ...f, smtpPassword: e.target.value }))
            }
            placeholder={settings.smtp.passwordSet ? 'Dejar vacío para no cambiar' : ''}
          />
        </Field>

        <Field label="Remitente">
          <input
            className="input"
            value={form.smtpFrom}
            onChange={(e) => setForm((f) => ({ ...f, smtpFrom: e.target.value }))}
            placeholder="SEO Crawler <no-reply@tudominio.com>"
          />
        </Field>

        <Field label="URL pública de la app">
          <input
            className="input"
            value={form.appUrl}
            onChange={(e) => setForm((f) => ({ ...f, appUrl: e.target.value }))}
            placeholder="https://seo.tudominio.com"
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Toggle
          label="Conexión segura (SSL/TLS directo)"
          checked={form.smtpSecure}
          onChange={(v) => setForm((f) => ({ ...f, smtpSecure: v }))}
        />
        <Toggle
          label="Permitir envío de informes por correo"
          checked={form.emailReportsEnabled}
          onChange={(v) => setForm((f) => ({ ...f, emailReportsEnabled: v }))}
        />
      </div>

      <p className="text-xs text-muted">
        El interruptor de informes es global: cada cuenta decide después si
        quiere recibirlos desde sus propios ajustes.
      </p>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy !== null}>
          {busy === 'save' ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => action('test-smtp')}
          disabled={busy !== null}
        >
          {busy === 'test-smtp' ? 'Probando…' : 'Probar conexión'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => action('send-test-email')}
          disabled={busy !== null}
        >
          {busy === 'send-test-email' ? 'Enviando…' : 'Enviarme un correo de prueba'}
        </button>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------- Google

function GoogleTab({
  settings,
  reload,
  setNotice,
  setError,
}: {
  settings: Settings;
  reload: () => Promise<void>;
  setNotice: (v: string | null) => void;
  setError: (v: string | null) => void;
}) {
  const [form, setForm] = useState({
    googleClientId: settings.google.clientId ?? '',
    googleClientSecret: '',
  });
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const payload: Record<string, unknown> = { ...form };
    if (!form.googleClientSecret) delete payload.googleClientSecret;

    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'No se pudo guardar');
      return;
    }

    setNotice('Credenciales guardadas');
    setForm((f) => ({ ...f, googleClientSecret: '' }));
    reload();
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <div>
        <p className="font-medium">
          Credenciales OAuth de Google{' '}
          <span
            className={`badge ml-1 ${settings.google.configured ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted'}`}
          >
            {settings.google.configured ? 'configuradas' : 'sin configurar'}
          </span>
        </p>
        <p className="text-sm text-muted">
          Identifican a esta aplicación ante Google, por eso son globales.
          Cada cuenta conecta después su propio Search Console con un botón,
          desde sus ajustes.
        </p>
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
        <li>
          En Google Cloud, crea un proyecto y habilita la{' '}
          <span className="text-fg">Search Console API</span>.
        </li>
        <li>
          Crea credenciales OAuth de tipo{' '}
          <span className="text-fg">Aplicación web</span>.
        </li>
        <li>
          Añade esta URI de redirección autorizada:
          <code className="mt-1 block break-all text-fg">
            {settings.google.redirectUri}
          </code>
        </li>
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client ID">
          <input
            className="input"
            value={form.googleClientId}
            onChange={(e) =>
              setForm((f) => ({ ...f, googleClientId: e.target.value }))
            }
            placeholder="xxxxx.apps.googleusercontent.com"
          />
        </Field>

        <Field
          label={`Client secret${settings.google.clientSecretSet ? ` (guardado: ${settings.google.clientSecretHint})` : ''}`}
        >
          <input
            type="password"
            className="input"
            value={form.googleClientSecret}
            onChange={(e) =>
              setForm((f) => ({ ...f, googleClientSecret: e.target.value }))
            }
            placeholder={
              settings.google.clientSecretSet ? 'Dejar vacío para no cambiar' : ''
            }
          />
        </Field>
      </div>

      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar credenciales'}
      </button>
    </form>
  );
}

// --------------------------------------------------------------- Serplify

function SerplifyTab({
  settings,
  reload,
  setNotice,
  setError,
}: {
  settings: Settings;
  reload: () => Promise<void>;
  setNotice: (v: string | null) => void;
  setError: (v: string | null) => void;
}) {
  const [form, setForm] = useState({
    serplifyApiKey: '',
    serplifyBaseUrl: settings.serplify.baseUrl,
    serplifyEnabled: settings.serplify.enabled,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setNotice(null);

    const payload: Record<string, unknown> = { ...form };
    if (!form.serplifyApiKey) delete payload.serplifyApiKey;

    const res = await fetch('/api/admin/settings', {
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

    setNotice('Configuración de Serplify guardada');
    setForm((f) => ({ ...f, serplifyApiKey: '' }));
    reload();
  }

  async function test() {
    setBusy('test');
    setError(null);
    setNotice(null);

    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'test-serplify' }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) setError(body.error ?? 'La prueba falló');
    else setNotice(body.message ?? 'Correcto');
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <div>
        <p className="font-medium">
          Serplify{' '}
          <span
            className={`badge ml-1 ${
              settings.serplify.configured && settings.serplify.enabled
                ? 'bg-ok/15 text-ok'
                : settings.serplify.configured
                  ? 'bg-warn/15 text-warn'
                  : 'bg-panel2 text-muted'
            }`}
          >
            {settings.serplify.configured && settings.serplify.enabled
              ? 'activo'
              : settings.serplify.configured
                ? 'desactivado'
                : 'sin configurar'}
          </span>
        </p>
        <p className="text-sm text-muted">
          Posición real en Google para cualquier keyword, incluidas aquellas
          donde todavía no apareces. Es una única clave para toda la
          instancia: el saldo de Serplify es prepago y compartido, así que
          todas las cuentas gastan del mismo monedero.
        </p>
      </div>

      <div className="rounded border border-line bg-bg p-3 text-xs text-muted">
        <p className="mb-1 font-medium text-fg">Coste</p>
        <p>
          $0,005 por consulta SERP correcta. Una consulta = una keyword medida
          una vez. Medir 100 keywords a diario son unos{' '}
          <span className="text-fg">$15/mes</span>; 500 keywords, unos{' '}
          <span className="text-fg">$75/mes</span>. Cada proyecto activa la
          medición por separado y ve su gasto real.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={`Clave de API${settings.serplify.apiKeySet ? ` (guardada: ${settings.serplify.apiKeyHint})` : ''}`}
        >
          <input
            type="password"
            className="input"
            value={form.serplifyApiKey}
            onChange={(e) =>
              setForm((f) => ({ ...f, serplifyApiKey: e.target.value }))
            }
            placeholder={
              settings.serplify.apiKeySet ? 'Dejar vacío para no cambiar' : 'live_…'
            }
          />
        </Field>

        <Field label="Base URL">
          <input
            className="input"
            value={form.serplifyBaseUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, serplifyBaseUrl: e.target.value }))
            }
            placeholder="https://api.serplify.io"
          />
        </Field>
      </div>

      <Toggle
        label="Permitir consultas SERP"
        checked={form.serplifyEnabled}
        onChange={(v) => setForm((f) => ({ ...f, serplifyEnabled: v }))}
      />

      <p className="text-xs text-muted">
        Desactivarlo corta el gasto de golpe en toda la instancia sin borrar
        la clave ni la configuración de los proyectos.
      </p>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy !== null}>
          {busy === 'save' ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={test}
          disabled={busy !== null || !settings.serplify.configured}
        >
          {busy === 'test' ? 'Probando…' : 'Probar conexión'}
        </button>
      </div>

      <p className="text-xs text-muted">
        La prueba consulta el listado de idiomas, que es gratuito: comprobar
        la clave no gasta saldo.
      </p>
    </form>
  );
}

// ----------------------------------------------------------------- Comunes

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded border border-line bg-bg px-3 py-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#4f9dff]"
      />
      {label}
    </label>
  );
}
