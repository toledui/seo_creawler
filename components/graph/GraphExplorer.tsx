'use client';

import { useState } from 'react';
import { TreeView } from './TreeView';
import { GraphView } from './GraphView';

type View = 'tree' | 'force';

/**
 * Selector entre las dos lecturas del mismo dato:
 *
 * - **Árbol**: una jerarquía con un único padre por URL. Es la vista por
 *   defecto porque responde a "cómo está organizado el sitio".
 * - **Grafo de fuerzas**: todos los enlaces internos. Útil para ver
 *   densidad y silos, pero en sitios con menú y footer globales todo
 *   aparece conectado con todo.
 */
export function GraphExplorer({ crawlId }: { crawlId: string }) {
  const [view, setView] = useState<View>('tree');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line bg-panel p-0.5">
          <button
            className={`rounded px-3 py-1.5 text-sm transition ${
              view === 'tree' ? 'bg-accent text-[#06121f]' : 'text-muted hover:text-fg'
            }`}
            onClick={() => setView('tree')}
          >
            Árbol
          </button>
          <button
            className={`rounded px-3 py-1.5 text-sm transition ${
              view === 'force' ? 'bg-accent text-[#06121f]' : 'text-muted hover:text-fg'
            }`}
            onClick={() => setView('force')}
          >
            Grafo de fuerzas
          </button>
        </div>

        <p className="text-xs text-muted">
          {view === 'tree'
            ? 'Cada URL cuelga de un único padre, así que la estructura se lee de un vistazo.'
            : 'Todos los enlaces internos a la vez: mide densidad, no jerarquía.'}
        </p>
      </div>

      {view === 'tree' ? (
        <TreeView crawlId={crawlId} />
      ) : (
        <GraphView crawlId={crawlId} />
      )}
    </div>
  );
}
