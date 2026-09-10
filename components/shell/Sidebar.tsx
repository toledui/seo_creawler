'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

type ProjectLink = { id: string; name: string; domain: string };

export function Sidebar({
  user,
  projects,
}: {
  user: { email: string; name: string | null; role: 'ADMIN' | 'MEMBER' };
  projects: ProjectLink[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const nav = (
    <nav className="flex h-full min-h-0 flex-col gap-1 p-3">
      <Link
        href="/dashboard"
        className="mb-4 shrink-0 px-2 text-lg font-semibold tracking-tight"
      >
        SEO<span className="text-accent">Crawler</span>
      </Link>

      <SideLink href="/dashboard" active={isActive('/dashboard')}>
        Dashboard
      </SideLink>
      <SideLink href="/projects" active={pathname === '/projects'}>
        Proyectos
      </SideLink>

      <div className="mt-4 shrink-0 px-2 text-[11px] uppercase tracking-wide text-muted">
        Mis proyectos
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {projects.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted">Todavía no hay proyectos</p>
        )}
        {projects.map((project) => {
          const active = pathname.startsWith(`/projects/${project.id}`);
          return (
            <div key={project.id}>
              <SideLink href={`/projects/${project.id}`} active={active} small>
                <span className="block truncate">{project.name}</span>
                <span className="block truncate text-[11px] text-muted">
                  {project.domain}
                </span>
              </SideLink>

              {active && (
                <div className="ml-3 border-l border-line pl-2">
                  <SideLink
                    href={`/projects/${project.id}/keywords`}
                    active={pathname.startsWith(`/projects/${project.id}/keywords`)}
                    small
                  >
                    Keywords
                  </SideLink>
                  <SideLink
                    href={`/projects/${project.id}/compare`}
                    active={pathname.startsWith(`/projects/${project.id}/compare`)}
                    small
                  >
                    Comparar crawls
                  </SideLink>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 shrink-0 space-y-1 border-t border-line pt-3">
        {user.role === 'ADMIN' && (
          <SideLink href="/admin" active={isActive('/admin')}>
            Administración
          </SideLink>
        )}
        <SideLink href="/settings" active={isActive('/settings')}>
          Ajustes
        </SideLink>
        <div className="px-2 pt-2 text-xs text-muted">
          <div className="truncate">{user.name ?? user.email}</div>
          <button onClick={logout} className="link mt-1 text-xs">
            Cerrar sesión
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      <button
        className="btn fixed left-3 top-3 z-40 md:hidden"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menú"
      >
        ☰
      </button>

      {/* Altura completa y sin scroll propio: dentro, sólo la lista de
          proyectos se desplaza si no cabe. */}
      <aside className="hidden h-full w-60 shrink-0 overflow-hidden border-r border-line bg-panel md:block">
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-60 border-r border-line bg-panel pt-12">
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}

function SideLink({
  href,
  active,
  small,
  children,
}: {
  href: string;
  active: boolean;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`block rounded px-2 py-1.5 transition ${
        small ? 'text-xs' : 'text-sm'
      } ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-fg/80 hover:bg-panel2 hover:text-fg'
      }`}
    >
      {children}
    </Link>
  );
}
