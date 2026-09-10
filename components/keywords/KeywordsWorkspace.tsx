'use client';

import { useState } from 'react';
import { KeywordsPanel } from './KeywordsPanel';
import { TrackingPanel } from './TrackingPanel';
import { SerpPanel } from './SerpPanel';

/**
 * Une el panel de conexión/tracking con la tabla de keywords.
 * El contador fuerza a la tabla a recargarse cuando el descubrimiento de
 * Search Console da de alta keywords nuevas.
 */
export function KeywordsWorkspace({
  projectId,
  projectDomain = '',
}: {
  projectId: string;
  projectDomain?: string;
}) {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="space-y-4">
      <TrackingPanel
        projectId={projectId}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
      <SerpPanel
        projectId={projectId}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
      <KeywordsPanel
        key={reloadKey}
        projectId={projectId}
        projectDomain={projectDomain}
      />
    </div>
  );
}
