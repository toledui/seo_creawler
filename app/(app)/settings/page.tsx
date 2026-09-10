import Link from 'next/link';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { formatDate, formatNumber } from '@/lib/format';
import { SectionTitle } from '@/components/ui';
import { AccountSettings } from '@/components/account/AccountSettings';
import { TeamPanel } from '@/components/account/TeamPanel';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();

  const [projects, crawls, pages, activeWorkers] = await Promise.all([
    prisma.project.count({ where: { userId: user.id } }),
    prisma.crawl.count({ where: { project: { userId: user.id } } }),
    prisma.page.count({ where: { crawl: { project: { userId: user.id } } } }),
    prisma.crawl.findMany({
      where: { status: 'RUNNING' },
      select: { workerId: true, heartbeatAt: true },
      distinct: ['workerId'],
    }),
  ]);

  return (
    <div className="max-w-4xl space-y-5">
      <SectionTitle
        title="Ajustes de la cuenta"
        description="Tu clave de IA, tu conexión con Search Console y tus avisos por correo."
        action={
          user.role === 'ADMIN' ? (
            <Link href="/admin" className="btn">
              Ir a Administración
            </Link>
          ) : undefined
        }
      />

      <Suspense fallback={<div className="card text-sm text-muted">Cargando…</div>}>
        <AccountSettings />
      </Suspense>

      <TeamPanel />

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold">Cuenta</h3>
        <dl className="space-y-2 text-sm">
          <Row label="Email" value={user.email} />
          <Row label="Nombre" value={user.name ?? '—'} />
          <Row
            label="Rol"
            value={user.role === 'ADMIN' ? 'Administrador' : 'Miembro'}
          />
          <Row label="Proyectos" value={formatNumber(projects)} />
          <Row label="Crawls" value={formatNumber(crawls)} />
          <Row label="URLs almacenadas" value={formatNumber(pages)} />
        </dl>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold">Configuración del crawler</h3>
        <p className="mb-3 text-xs text-muted">
          Estos valores se leen de <code>.env</code>; reinicia el servidor y el
          worker tras cambiarlos.
        </p>
        <dl className="space-y-2 text-sm">
          <Row label="User agent" value={env.crawler.userAgent} />
          <Row
            label="Concurrencia máxima"
            value={String(env.crawler.maxConcurrency)}
          />
          <Row label="Timeout HTTP" value={`${env.crawler.timeoutMs} ms`} />
          <Row label="Máx. redirects" value={String(env.crawler.maxRedirects)} />
          <Row
            label="Máx. tamaño HTML"
            value={`${(env.crawler.maxHtmlBytes / 1024 / 1024).toFixed(1)} MB`}
          />
          <Row
            label="Hosts privados permitidos"
            value={env.crawler.allowPrivateHosts ? 'Sí (sólo para pruebas)' : 'No'}
          />
        </dl>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold">Worker</h3>
        {activeWorkers.length === 0 ? (
          <p className="text-sm text-muted">
            No hay crawls en ejecución. Arranca el worker con{' '}
            <code className="text-fg">npm run worker</code> para que procese la
            cola.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {activeWorkers.map((worker) => (
              <li key={worker.workerId ?? 'sin-id'} className="flex justify-between">
                <span className="font-mono text-xs">{worker.workerId ?? '—'}</span>
                <span className="text-muted">
                  último latido: {formatDate(worker.heartbeatAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="col-span-2 break-words">{value}</dd>
    </div>
  );
}
