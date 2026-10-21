"use client";

import { useRef, useState } from 'react';
import { AlertCircle, Download, FileCheck2, History, Mail, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type Preview = {
  invoiceId: number; invoiceNumber: string; balanceVersion: string; totalCents: string;
  paidCents: string; recipient: string | null; openCents: string; feeCents: string; subject: string; text: string;
  reminderLevel: number; paymentHistory: { amountCents: string; paidAt: string; reference: string }[];
};
const euro = (cents: string) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(cents) / 100);

/** Export and internal bookkeeping only. No automatic email or financial mutation. Zero-payment mailto composition remains explicitly user-triggered. */
export function ReminderWorkbenchDialog({ invoice, onClose, onRecorded }: {
  invoice: { id: number; invoiceNumber: string | null; fileName: string; nextReminderLevelLabel: string };
  onClose: () => void; onRecorded: () => Promise<void>;
}) {
  const [fee, setFee] = useState('0');
  const [dueDays, setDueDays] = useState('14');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const options = { fee, dueDays, notes: notes || null };
  const invalidate = () => { setPreview(null); setConfirmed(false); setError(null); key.current = null; };
  const loadPreview = async () => {
    setBusy(true); setError(null); setConfirmed(false); setPreview(null); key.current = null;
    try {
      const response = await fetch('/api/reminders/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice.id, ...options }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Der aktuelle Restbetrag konnte nicht geprüft werden.');
      setPreview(data); key.current = crypto.randomUUID();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Restbetrag konnte nicht geprüft werden.'); }
    finally { setBusy(false); }
  };
  const act = async (action: 'download' | 'record' | 'mail') => {
    if (!preview || !confirmed || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(action === 'download' ? '/api/reminders/download' : action === 'mail' ? '/api/reminders/preview' : '/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        invoiceId: invoice.id, ...options, reminderLevel: preview.reminderLevel,
        expectedBalanceVersion: preview.balanceVersion, idempotencyKey: key.current,
      }) });
      if (!response.ok) {
        const data = await response.json();
        if (['PAYMENT_STATE_CHANGED', 'PAYMENT_REVIEW_REQUIRED', 'INVOICE_NOT_OPEN'].includes(data.code)) { setPreview(null); setConfirmed(false); key.current = null; }
        throw new Error(data.error || 'Die Aktion konnte nicht abgeschlossen werden.');
      }
      if (action === 'mail') {
        const fresh = await response.json() as Preview;
        if (fresh.paidCents !== '0') throw new Error('Nach Zahlungseingang bitte den Restbetrags-Textentwurf verwenden.');
        // Existing zero-payment manual compose action only; the user sends in their mail client.
        window.location.href = `mailto:${encodeURIComponent(fresh.recipient || '')}?subject=${encodeURIComponent(fresh.subject)}&body=${encodeURIComponent(fresh.text)}`;
      } else if (action === 'download') {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a'); link.href = url; link.download = `mahnentwurf-${invoice.id}.txt`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else { await onRecorded(); onClose(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Aktion konnte nicht abgeschlossen werden.'); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{invoice.nextReminderLevelLabel} vorbereiten</DialogTitle>
        <DialogDescription>Rechnung {invoice.invoiceNumber || invoice.fileName} · aktueller Restbetrag statt ursprünglicher Forderung</DialogDescription>
      </DialogHeader>
      <Alert><FileCheck2 aria-hidden="true" className="h-4 w-4" /><AlertTitle>Sie behalten die Kontrolle</AlertTitle><AlertDescription>Es wird keine E-Mail automatisch versendet. Vorschau und Textdownload versenden keine Nachricht und buchen keine Zahlung. Speichern dokumentiert nur die interne Erfassung. Für Teilzahlungen ist der direkte E-Mail-Versand hier nicht freigeschaltet.</AlertDescription></Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="reminder-fee">Mahngebühr (EUR, manuell)</Label><Input id="reminder-fee" type="number" step="0.01" min="0" value={fee} disabled={busy} onChange={e => { setFee(e.target.value); invalidate(); }} /><p className="text-xs text-muted-foreground">Standard 0 EUR. Keine automatische Gebührenberechnung; bitte eine eingetragene Gebühr selbst prüfen.</p></div>
        <div className="space-y-2"><Label htmlFor="reminder-due-days">Zahlungsfrist (Tage)</Label><Input id="reminder-due-days" type="number" min="1" max="365" value={dueDays} disabled={busy} onChange={e => { setDueDays(e.target.value); invalidate(); }} /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="reminder-notes">Hinweis im Entwurf (optional)</Label><Textarea id="reminder-notes" value={notes} disabled={busy} maxLength={5000} onChange={e => { setNotes(e.target.value); invalidate(); }} /><p className="text-xs text-muted-foreground">Dieser Hinweis erscheint auch im heruntergeladenen Text, nicht nur in der internen Historie.</p></div>
      </div>
      <Button variant="outline" disabled={busy} onClick={loadPreview} className="w-full whitespace-normal"><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />{busy ? 'Wird geprüft …' : 'Aktuellen Restbetrag prüfen und Entwurf laden'}</Button>
      {error && <Alert variant="destructive" role="alert"><AlertCircle aria-hidden="true" className="h-4 w-4" /><AlertTitle>Bitte erneut prüfen</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {preview && <section aria-label="Geprüfter Mahnentwurf" className="min-w-0 space-y-5">
        <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-3" aria-label="Geprüfter Zahlungsstand">
          <div><dt className="text-xs text-muted-foreground">Rechnungsbetrag</dt><dd className="mt-1 font-medium">{euro(preview.totalCents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Bereits eingegangen</dt><dd className="mt-1 font-medium">{euro(preview.paidCents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Offener Restbetrag</dt><dd className="mt-1 text-xl font-semibold">{euro(preview.openCents)}</dd></div>
        </dl>
        <section aria-label="Zahlungsverlauf" className="rounded-xl border p-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><History aria-hidden="true" className="h-4 w-4" />Belegte Zahlungseingänge</h3>
          {preview.paymentHistory.length ? <ul className="space-y-3">{preview.paymentHistory.map((payment, index) => <li key={index} className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm first:border-0 first:pt-0"><div className="min-w-0"><span>{new Date(payment.paidAt).toLocaleDateString('de-DE', { timeZone: 'UTC' })}</span><p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{payment.reference}</p></div><strong>{euro(payment.amountCents)}</strong></li>)}</ul> : <p className="text-sm text-muted-foreground">Keine Zahlung im Journal erfasst.</p>}
        </section>
        {preview.recipient && <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">Empfänger für den manuellen Versand: {preview.recipient}</p>}
        <div className="min-w-0 rounded-xl border p-4"><h3 className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{preview.subject}</h3><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed [overflow-wrap:anywhere]">{preview.text}</pre></div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" /><span>Ich habe den offenen Restbetrag von <strong>{euro(preview.openCents)}</strong> und den Entwurf geprüft. Vor Download oder Erfassung wird der Zahlungsstand erneut serverseitig abgeglichen.</span></label>
      </section>}
      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={busy}>Abbrechen</Button>
        {preview?.paidCents === '0' && <Button variant="outline" disabled={busy || !confirmed} onClick={() => act('mail')}><Mail aria-hidden="true" className="mr-2 h-4 w-4" />Im E-Mail-Client öffnen</Button>}
        <Button variant="outline" disabled={busy || !confirmed || !preview} onClick={() => act('download')}><Download aria-hidden="true" className="mr-2 h-4 w-4" />Textentwurf herunterladen</Button>
        <Button disabled={busy || !confirmed || !preview} onClick={() => act('record')}>Mahnung intern erfassen</Button>
      </div>
      <p className="text-xs text-muted-foreground">Der Text ist eine Momentaufnahme für Ihren manuellen Versand. Nach späteren Zahlungen bitte neu prüfen. Die Originalrechnung und ihr PDF bleiben unverändert.</p>
    </DialogContent>
  </Dialog>;
}
