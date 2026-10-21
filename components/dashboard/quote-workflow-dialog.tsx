"use client";

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { QUOTE_STATUSES, type QuoteWorkflowUpdate } from '@/lib/quote-workflow';
import type { Quote } from '@/components/dashboard/tabs/quotes-tab';

export const QUOTE_STATUS_LABELS: Record<string, string> = { DRAFT: 'Entwurf', SENT: 'Versendet', ACCEPTED: 'Angenommen – von mir erfasst', REJECTED: 'Abgelehnt – von mir erfasst', EXPIRED: 'Abgelaufen', CANCELLED: 'Zurückgezogen' };

export function QuoteWorkflowDialog({ quote, onClose, onSaved }: { quote: Quote; onClose: () => void; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState(quote.status);
  const [date, setDate] = useState(quote.quoteFollowUpOn ?? '');
  const [note, setNote] = useState(quote.quoteResponseNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = !!quote.convertedInvoice || !['DRAFT', 'SENT'].includes(status);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const change: QuoteWorkflowUpdate = { status, quoteFollowUpOn: date || null, quoteResponseNote: note || null };
      const response = await fetch(`/api/quotes/${quote.id}/workflow`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...change, expected: { status: quote.status, quoteFollowUpOn: quote.quoteFollowUpOn ?? null, quoteResponseNote: quote.quoteResponseNote ?? null } }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Die Änderung konnte nicht gespeichert werden. Bitte erneut versuchen.');
      }
      await onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen. Ihre Eingabe bleibt erhalten.'); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onInteractOutside={event => { if (saving) event.preventDefault(); }} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>Rückmeldung &amp; Nachfassen</DialogTitle>
        <DialogDescription>{quote.invoiceNumber || 'Angebot'}{quote.customer?.name ? ` · ${quote.customer.name}` : ''}. Nur Ihre interne Planung. Es wird nichts an Kunden gesendet.</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="space-y-5">
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-critical-surface p-3 text-sm text-critical-foreground">{error}</p>}
        <div className="space-y-2">
          <Label htmlFor="quote-response-status">Stand manuell festhalten</Label>
          <select id="quote-response-status" value={status} disabled={saving} onChange={event => setStatus(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            {QUOTE_STATUSES.map(value => <option key={value} value={value}>{QUOTE_STATUS_LABELS[value]}</option>)}
          </select>
          <p className="text-sm text-muted-foreground">„Angenommen“ dokumentiert Ihre eigene Eingabe – keine elektronische Bestätigung des Kunden.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quote-followup-date">Wieder bei mir auf den Tisch am</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="quote-followup-date" type="date" value={date} disabled={saving} onChange={event => setDate(event.target.value)} className="min-w-0 flex-1" />
            {date && <Button type="button" variant="outline" disabled={saving} onClick={() => setDate('')}>Datum entfernen</Button>}
          </div>
          <p className="text-sm text-muted-foreground">{closed ? 'Datum bleibt gespeichert; erledigte oder in Rechnung übernommene Angebote erzeugen keine aktive Nachfass-Aufgabe.' : 'Ab diesem Kalendertag erscheint das Angebot unter „Nachfassen“. Nur in Bivaro, ohne automatische Erinnerung oder E-Mail.'}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quote-response-note">Interne Notiz / Grund der Rückmeldung</Label>
          <textarea id="quote-response-note" rows={4} maxLength={2000} value={note} disabled={saving} onChange={event => setNote(event.target.value)} placeholder="Zum Beispiel: Preis telefonisch besprochen; am Freitag nachfragen." className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <p className="text-sm text-muted-foreground">Nur intern gespeichert, nicht im Angebots-PDF oder im Rechnungsentwurf. {note.length}/2000 Zeichen</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Abbrechen</Button>
          <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Änderungen speichern</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
