'use client';

import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IncomingDocument } from '@/lib/purchase-documents/types';
import { errorMessage, incomingResponseError } from './incoming-document-ui';

/** Authenticated bytes live only in a short-lived object URL, never local/session storage. */
export function IncomingPhotoPreview({ document }: { document: IncomingDocument }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null); setError(null); setZoom(1);
    fetch(document.originalRef.downloadUrl, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw incomingResponseError(response.status, await response.json().catch(() => null));
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (blob.type !== document.originalRef.mediaType || blob.size !== document.originalRef.bytes) throw new Error('Die Fotoantwort stimmt nicht mit dem Original überein. Bitte erneut laden.');
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      }).catch(caught => { if (!controller.signal.aborted) setError(errorMessage(caught)); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document.originalRef.downloadUrl, document.originalRef.mediaType, document.originalRef.bytes, refresh]);
  return <section aria-label="Foto-Original Vorschau" className="mb-5 rounded-lg border border-border bg-secondary/40 p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Foto-Original</h3><div className="flex items-center gap-1"><Button size="icon" variant="outline" aria-label="Foto verkleinern" disabled={!url || zoom === 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}><ZoomOut className="size-4" /></Button><span className="w-12 text-center text-xs tabular-nums" aria-live="polite">{zoom * 100}%</span><Button size="icon" variant="outline" aria-label="Foto vergrößern" disabled={!url || zoom === 3} onClick={() => setZoom(value => Math.min(3, value + 0.5))}><ZoomIn className="size-4" /></Button></div></div>
    {error ? <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button variant="outline" onClick={() => setRefresh(value => value + 1)}><RotateCcw className="size-4" />Vorschau erneut laden</Button></div> : !url ? <p role="status" className="flex items-center gap-2 py-8 text-sm"><Loader2 className="size-4 animate-spin" />Foto wird sicher geladen…</p> : <div tabIndex={0} role="region" aria-label="Zoombare Fotoansicht; mit Pfeiltasten verschieben" className="max-h-[60dvh] overflow-auto rounded border border-border bg-background focus-visible:outline-2 focus-visible:outline-ring">
      {/* Native image avoids an optimizer/public URL and preserves the authenticated source. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Unverändertes Foto-Original: ${document.originalRef.fileName}`} className="block h-auto max-w-none" style={{ width: `${zoom * 100}%` }} onError={() => setError('Das Foto kann nicht angezeigt werden. Original herunterladen oder Vorschau erneut laden.')} />
    </div>}
    <p className="mt-2 text-xs text-muted-foreground">Eine Seite je Beleg. Weitere Seiten separat hinzufügen. Keine automatische Buchung.</p>
  </section>;
}
