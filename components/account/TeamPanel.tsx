'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDate } from '@/lib/format';

type Member = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: 'EDITOR' | 'VIEWER';
  isActive: boolean;
  pending: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type Workspace = {
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
};

const ROLE_HELP: Record<string, string> = {
  EDITOR: 'Crea proyectos, lanza crawls y genera informes.',
  VIEWER: 'Sólo consulta: ve datos e informes, no puede modificar nada.',
};

/**
 * Equipo del espacio de trabajo.
 *
 * Cada cuenta invita a quien quiera con permiso de edición o de sólo
 * lectura. Los invitados ven los proyectos del anfitrión mezclados con los
 * suyos, y el rol decide si además pueden tocarlos.
 */
export function TeamPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState(true);
  const [form, setForm] = useState({ email: '', name: '', role: 'VIEWER' });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/account/team', { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json();
    setMembers(body.members ?? []);
    setWorkspaces(body.workspaces ?? []);
    setSmtpConfigured(Boolean(body.smtpConfigured));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy('invite');
    setError(null);
    setNotice(null);
    setInviteUrl(null);

    const res = await fetch('/api/account/team', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? 'No se pudo invitar');
      return;
    }

    setNotice(
      body.delivered
        ? `Invitación enviada a ${form.email}.`
        : body.isNewAccount
          ? 'Cuenta creada, pero no se pudo enviar el correo. Pásale el enlace a mano.'
          : `${form.email} ya tenía cuenta: ahora entra con su contraseña de siempre.`,
    );
    if (body.inviteUrl) setInviteUrl(body.inviteUrl);

    setForm({ email: '', name: '', role: 'VIEWER' });
    load();
  }

  async function patch(memberId: string, payload: object, message: string) {
    setBusy(memberId);
    setError(null);
    setNotice(null);
    setInviteUrl(null);

    const res = await fetch(`/api/account/team/${memberId}`, {
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
    setNotice(message);
    load();
  }

  async function remove(member: Member) {
    if (!confirm(`¿Quitar el acceso de ${member.email}? Su cuenta no se borra.`)) {
      return;
    }

    setBusy(member.id);
    const res = await fetch(`/api/account/team/${member.id}`, { method: 'DELETE' });
    setBusy(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'No se pudo quitar');
      return;
    }

    setNotice('Acceso retirado');
    load();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={invite} className="card space-y-3">
        <div>
          <p className="font-medium">Equipo</p>
          <p className="text-sm text-muted">
            Invita a más personas a tu cuenta. Verán tus proyectos y, según su
            rol, podrán modificarlos o sólo consultarlos.
          </p>
        </div>

        {!smtpConfigured && (
          <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            No hay servidor de correo configurado: el enlace de acceso se
            mostrará aquí para que lo pases a mano.
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

          <div className="min-w-[150px] flex-1">
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Permiso</label>
            <select
              className="input w-auto"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              <option value="VIEWER">Sólo lectura</option>
              <option value="EDITOR">Editor</option>
            </select>
          </div>

          <button className="btn btn-primary" disabled={busy === 'invite'}>
            {busy === 'invite' ? 'Invitando…' : 'Invitar'}
          </button>
        </div>

        <p className="text-xs text-muted">{ROLE_HELP[form.role]}</p>

        {inviteUrl && (
          <div className="rounded border border-warn/40 bg-warn/10 p-3 text-xs">
            <p className="mb-1 font-medium text-warn">Enlace de acceso</p>
            <code className="break-all text-fg">{inviteUrl}</code>
          </div>
        )}
      </form>

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

      {members.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Permiso</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className={member.isActive ? '' : 'opacity-50'}>
                  <td>
                    <div className="font-medium">{member.name ?? '—'}</div>
                    <div className="text-xs text-muted">{member.email}</div>
                  </td>
                  <td>
                    <select
                      className="input w-auto py-1 text-xs"
                      value={member.role}
                      disabled={busy === member.id}
                      onChange={(e) =>
                        patch(member.id, { role: e.target.value }, 'Permiso actualizado')
                      }
                    >
                      <option value="VIEWER">Sólo lectura</option>
                      <option value="EDITOR">Editor</option>
                    </select>
                  </td>
                  <td>
                    {member.pending ? (
                      <span className="badge bg-warn/15 text-warn">sin activar</span>
                    ) : member.isActive ? (
                      <span className="badge bg-ok/15 text-ok">activa</span>
                    ) : (
                      <span className="badge bg-panel2 text-muted">desactivada</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs text-muted">
                    {member.lastLoginAt ? formatDate(member.lastLoginAt) : 'nunca'}
                  </td>
                  <td className="whitespace-nowrap text-right text-xs">
                    {member.pending && (
                      <button
                        className="link"
                        disabled={busy === member.id}
                        onClick={() =>
                          patch(
                            member.id,
                            { action: 'resend-invite' },
                            'Invitación reenviada',
                          )
                        }
                      >
                        Reenviar
                      </button>
                    )}
                    <button
                      className="ml-2 text-bad hover:underline"
                      disabled={busy === member.id}
                      onClick={() => remove(member)}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {workspaces.length > 0 && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold">
            Cuentas a las que tienes acceso
          </h3>
          <ul className="space-y-1 text-sm">
            {workspaces.map((workspace) => (
              <li
                key={workspace.ownerId}
                className="flex items-center justify-between gap-2"
              >
                <span>
                  {workspace.ownerName ?? workspace.ownerEmail}
                  <span className="ml-2 text-xs text-muted">
                    {workspace.ownerEmail}
                  </span>
                </span>
                <span
                  className={`badge ${
                    workspace.role === 'EDITOR'
                      ? 'bg-accent/15 text-accent'
                      : 'bg-panel2 text-muted'
                  }`}
                >
                  {workspace.role === 'EDITOR' ? 'Editor' : 'Sólo lectura'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Sus proyectos aparecen en tu barra lateral junto a los tuyos.
          </p>
        </div>
      )}
    </div>
  );
}
