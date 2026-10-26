'use client';

import type { ManualEntrySubmitState } from '@/lib/manual-entry-submission';
import { Button } from '@/components/ui/button';

export type ManualEntrySubmitControls = {
  state: ManualEntrySubmitState;
  onDiscard: () => void;
  onRefresh: () => void;
  onStopWaiting: () => void;
  refreshing: boolean;
};

export function ManualEntrySubmitFeedback({ controls, nextLabel = 'Neue Erfassung beginnen' }: {
  controls?: ManualEntrySubmitControls;
  nextLabel?: string;
}) {
  if (!controls) return null;
  const { state, onDiscard, onRefresh, onStopWaiting, refreshing } = controls;
  if (state.phase === 'idle') return state.message ? <p role="alert" className="mt-3 text-sm text-destructive">{state.message}</p> : null;
  if (state.phase === 'pending') return <div role="status" className="mt-3 space-y-3 text-sm text-muted-foreground"><p>Wird gespeichert. Der Auftrag kann auf dem Server bereits laufen; Navigation oder Schließen wäre kein Rückruf.</p><Button type="button" variant="outline" onClick={onStopWaiting}>Warten beenden / Liste prüfen</Button></div>;
  if (state.phase === 'discarding') return <p role="status" className="mt-3 text-sm text-muted-foreground">Lokaler Entwurf wird verworfen. Serverseitige Arbeit wird nicht zurückgenommen.</p>;
  const unknown = state.phase === 'unknown';
  return <div role={unknown ? 'alert' : 'status'} className="mt-3 space-y-3 rounded-md border p-3 text-sm">
    <p>{unknown
      ? 'Speicherausgang unklar. Der Datensatz kann bereits gespeichert sein. Nicht erneut senden; prüfen Sie zuerst die Liste. Ein gleicher Listeneintrag beweist den Ausgang dieses Auftrags nicht.'
      : 'Gespeichert. Dieser Auftrag wird nicht erneut gesendet.'}</p>
    {state.message && <p>{state.message}</p>}
    {unknown && <p>Verwerfen löscht nur diesen lokalen Entwurf und nimmt serverseitige Arbeit nicht zurück. Nach einem Reload oder in einem anderen Tab besteht keine Wiederholungssperre.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Liste wird angefordert …' : 'Liste aktualisieren (nur lesen)'}</Button>
      <Button type="button" variant="outline" onClick={onDiscard}>{unknown ? 'Lokalen Entwurf verwerfen' : nextLabel}</Button>
    </div>
  </div>;
}
