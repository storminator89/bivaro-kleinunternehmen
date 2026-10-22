'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PurchaseDocumentError } from '@/lib/purchase-documents/errors';
import { EMPTY_REVIEW_DRAFT, parsePurchaseReviewDraft } from '@/lib/purchase-documents/review-draft';
import type { IncomingDocument, IncomingDocumentResponse, PurchaseReviewDraft } from '@/lib/purchase-documents/types';
import { sameReviewDraft } from './incoming-review-queue';
import { errorMessage, incomingJson, IncomingRequestError } from './incoming-document-ui';

export type IncomingDraftHandle = { save: () => Promise<boolean> };

export function IncomingReviewDraft({ document, onSaved, onDirtyChange, onBusyChange, locked = false, saveRef, secondary = false }: { saveRef?: Ref<IncomingDraftHandle>; secondary?: boolean; document: IncomingDocument; onSaved: (document: IncomingDocument) => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void; locked?: boolean }) {
  const baseline = document.reviewDraft ?? EMPTY_REVIEW_DRAFT;
  const [draft, setDraft] = useState<PurchaseReviewDraft>(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const pendingSave = useRef<{ revision: number; draft: PurchaseReviewDraft } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  useImperativeHandle(saveRef, () => ({ save }));
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function save(): Promise<boolean> {
    if (busyRef.current || locked) return false;
    if (!dirty && document.reviewDraftSavedAt) return true;
    setError(null); setSaved(false);
    let normalized: PurchaseReviewDraft;
    try { normalized = parsePurchaseReviewDraft(draft); } catch (caught) { setError(caught instanceof PurchaseDocumentError ? caught.message : 'Prüfentwurf ist ungültig.'); return false; }
    const controller = new AbortController(); request.current = controller;
    busyRef.current = true; setBusy(true); onBusyChange(true);
    try {
      // An unknown response is reconciled before another write. The existing
      // revision precondition remains authoritative; never invent a new revision.
      if (pendingSave.current) {
        const current = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${document.id}`, { signal: controller.signal });
        if (!alive.current) return false;
        if (current.document.id !== document.id) throw new IncomingRequestError('Der aktuelle Belegstatus konnte nicht sicher zugeordnet werden. Bitte neu laden.');
        const pending = pendingSave.current;
        if (current.document.reviewState === 'REVIEW' && current.document.linkedExpenseId === null && current.document.revision === pending.revision + 1 && sameReviewDraft(current.document.reviewDraft, pending.draft) && sameReviewDraft(normalized, pending.draft)) {
          pendingSave.current = null;
          setDraft(current.document.reviewDraft ?? EMPTY_REVIEW_DRAFT); onSaved(current.document); setSaved(true);
          return true;
        }
        if (current.document.revision !== pending.revision || current.document.reviewState !== 'REVIEW' || current.document.linkedExpenseId !== null) throw new IncomingRequestError('Der Beleg wurde inzwischen geändert. Bitte den aktuellen Belegstatus neu laden; deine Eingaben bleiben bis dahin hier erhalten.', 409);
      }
      pendingSave.current = { revision: document.revision, draft: normalized };
      const result = await incomingJson<IncomingDocumentResponse>(`/api/purchase-documents/${document.id}/review-draft`, { signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: document.revision, draft: normalized }) });
      if (!alive.current) return false;
      pendingSave.current = null;
      setDraft(result.document.reviewDraft ?? EMPTY_REVIEW_DRAFT); onSaved(result.document); setSaved(true);
      return true;
    } catch (caught) { if (alive.current) setError(`${errorMessage(caught)} Die Speicherung ist nicht bestätigt. Eingaben bleiben hier erhalten; bei unklarer Antwort Belegstatus neu laden, bevor du erneut speicherst.`); return false; }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  }
  const fields = [
    ['supplierName', 'Lieferant', 'text', 1000], ['invoiceNumber', 'Rechnungsnummer', 'text', 255],
    ['invoiceDate', 'Rechnungsdatum', 'date', 10], ['paymentDate', 'Zahlungsdatum', 'date', 10], ['amount', 'Bruttobetrag (EUR)', 'text', 32],
  ] as const;
  return <section aria-labelledby="review-draft-heading" className="mb-5 rounded-lg border border-border p-4">
    <h3 id="review-draft-heading" className="font-semibold">Prüfentwurf · nicht gebucht</h3>
    <details className="text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">Zum Prüfentwurf</summary><p>Original bleibt unverändert. KI-Angaben sind ungeprüfte Vorschläge. Keine Zahlungs- oder Steuerbestätigung. Leere Felder sind erlaubt.</p></details>
    {document.originalRef.mediaType.startsWith('image/') && <p className="mt-2 text-sm text-caution-foreground">Foto prüfen, Entwurf speichern, Lieferant wählen. Erst die abschließende Bestätigung bucht die Ausgabe.</p>}
    {locked && <p id="review-draft-lock-help" role="status" className="mt-3 border-l-2 border-caution pl-3 text-sm text-caution-foreground">Entwurf vorübergehend gesperrt: erst die offene Belegaktion abbrechen oder abschließen. Beim Verwerfen wird kein Prüfentwurf still gespeichert.</p>}
    <form aria-describedby={locked ? 'review-draft-lock-help' : undefined} className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label, type, maxLength]) => <div key={key} className="min-w-0 space-y-2"><Label htmlFor={`review-draft-${key}`}>{label}</Label><Input id={`review-draft-${key}`} type={type} inputMode={key === 'amount' ? 'decimal' : undefined} value={draft[key]} maxLength={maxLength} disabled={busy || locked} onChange={event => { setDraft(previous => ({ ...previous, [key]: event.target.value })); setSaved(false); }} /></div>)}</div>
      <div className="space-y-2"><Label htmlFor="review-draft-note">Prüfnotiz</Label><textarea id="review-draft-note" value={draft.note} maxLength={2000} disabled={busy || locked} rows={3} className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" onChange={event => { setDraft(previous => ({ ...previous, note: event.target.value })); setSaved(false); }} /></div>
      <p className="text-xs text-muted-foreground">Vor Verlassen speichern; keine automatische Speicherung.</p>
      {error && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded bg-critical-surface p-3 text-sm text-critical-foreground">{error}</div>}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 bg-card py-3"><Button type="submit" variant={secondary ? 'outline' : 'default'} disabled={busy || locked || (!dirty && !!document.reviewDraftSavedAt)}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Prüfentwurf speichern</Button><p role="status" className="text-xs text-muted-foreground">{busy ? 'Wird gespeichert…' : dirty ? 'Ungespeicherte Änderungen' : saved || document.reviewDraftSavedAt ? 'Prüfentwurf gespeichert · nicht gebucht' : 'Noch kein Prüfentwurf gespeichert'}</p></div>
    </form>
  </section>;
}

export function IncomingSavedDraft({ document }: { document: IncomingDocument }) {
  const draft = document.reviewDraft;
  if (!draft) return null;
  return <section aria-label="Gespeicherter Prüfentwurf" className="mb-5 rounded-lg border border-border p-4 text-sm"><h3 className="font-semibold">Gespeicherter Prüfentwurf · keine Buchungsbestätigung</h3><p className="mt-2 text-muted-foreground">Arbeitsstand · Kein Zahlungsnachweis.</p><dl className="mt-3 space-y-2 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:break-words"><div><dt>Lieferant / Rechnungsnummer</dt><dd>{[draft.supplierName, draft.invoiceNumber].filter(Boolean).join(' · ') || 'Nicht angegeben'}</dd></div><div><dt>Rechnungsdatum / Zahlungsdatum im Entwurf</dt><dd>{[draft.invoiceDate, draft.paymentDate].filter(Boolean).join(' · ') || 'Nicht angegeben'}</dd></div><div><dt>Entwurfsbetrag (EUR)</dt><dd>{draft.amount || 'Nicht angegeben'}</dd></div><div><dt>Prüfnotiz</dt><dd className="whitespace-pre-wrap">{draft.note || 'Nicht angegeben'}</dd></div></dl></section>;
}
