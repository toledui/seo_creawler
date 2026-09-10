'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '', label: 'Overview' },
  { href: '/pages', label: 'Pages' },
  { href: '/issues', label: 'Issues' },
  { href: '/graph', label: 'Site Graph' },
  { href: '/silos', label: 'Silos' },
  { href: '/geo', label: 'GEO' },
  { href: '/ai', label: 'AI Audit' },
  { href: '/exports', label: 'Exports' },
];

export function CrawlTabs({
  base,
  projectId,
}: {
  base: string;
  projectId: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-line pb-px">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = tab.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.href}
            href={href}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
              active
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}

      {/* Keywords y posiciones cuelgan del proyecto, no del crawl: van
          separadas para que se vea que salen de esta vista. */}
      <span className="mx-2 h-4 w-px shrink-0 bg-line" aria-hidden />
      <Link
        href={`/projects/${projectId}/keywords`}
        className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted transition hover:text-fg"
      >
        Keywords y posiciones ↗
      </Link>
    </nav>
  );
}
