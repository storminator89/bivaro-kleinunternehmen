'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ServiceArticlePicker } from '@/components/dashboard/service-article-picker';
import { calculateInvoiceAmounts } from '@/lib/invoice-calculation';
import { readServiceBillingPlanInput } from '@/lib/service-billing';
import { CADENCE_LABELS, SERVICE_SELECT_CLASS, serviceCurrency, serviceDate, serviceJson, type ServiceBillingLine, type ServiceBillingPlanDto } from './service-billing-types';
import styles from './service-billing-workspace.module.css';
import { captureServiceDialogOpener, restoreServiceDialogOpener } from './service-dialog-focus';

type LineDraft = Omit<ServiceBillingLine, 'quantity' | 'unitPrice'> & { quantity: string; unitPrice: string };
const blankLine = (): LineDraft => ({ description: '', quantity: '1', unitPrice: '', unit: 'Pauschal', taxRate: 0, taxCategory: 'E' });

export function ServicePlanEditor({ plan, today, onClose, onSaved }: {
  plan: ServiceBillingPlanDto | null;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const openerRef = useRef<HTMLElement | null>(null);
  const [requestId] = useState(() => globalThis.crypto.randomUUID());
  const [name, setName] = useState(plan?.name ?? '');
  const [customerId, setCustomerId] = useState(plan ? String(plan.customerId) : '');
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState('');
  const [reload, setReload] = useState(0);
  const [cadence, setCadence] = useState<ServiceBillingPlanDto['cadence']>(plan?.cadence ?? 'MONTHLY');
  const [anchorDate, setAnchorDate] = useState(plan?.anchorDate ?? today);
  const [taxMode, setTaxMode] = useState<ServiceBillingPlanDto['taxMode'] | ''>(plan?.taxMode ?? '');
  const [lines, setLines] = useState<LineDraft[]>(plan?.items.map(line => ({ ...line, quantity: String(line.quantity), unitPrice: line.unitPrice.toFixed(2) })) ?? [blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setCustomersLoading(true); setCustomersError('');
    serviceJson<{ id: number; name: string }[]>('/api/customers', { signal: controller.signal })
      .then(data => {
        if (!Array.isArray(data)) throw new Error('Die Kundenliste konnte nicht gelesen werden.');
        if (!controller.signal.aborted) setCustomers(data);
      })
      .catch(failure => { if (!controller.signal.aborted) setCustomersError(failure instanceof Error ? failure.message : 'Kunden konnten nicht geladen werden.'); })
      .finally(() => { if (!controller.signal.aborted) setCustomersLoading(false); });
    return () => controller.abort();
  }, [reload]);

  function changeTaxMode(value: ServiceBillingPlanDto['taxMode'] | '') {
    setTaxMode(value);
    if (value) setLines(current => current.map(line => ({ ...line, taxRate: value === 'small-business' ? 0 : line.taxRate === 7 ? 7 : 19, taxCategory: value === 'small-business' ? 'E' : 'S', exemptionReason: undefined })));
  }
  function updateLine(index: number, update: Partial<LineDraft>) { setLines(current => current.map((line, position) => position === index ? { ...line, ...update } : line)); }
  const nativeLines: ServiceBillingLine[] = lines.map(line => ({ ...line, description: line.description.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }));
  let total: number | null = null;
  try { if (taxMode && lines.every(line => line.description.trim() && line.quantity.trim() && line.unitPrice.trim())) total = calculateInvoiceAmounts(nativeLines).grossAmount; } catch { /* Incomplete entries remain editable. */ }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!taxMode) { setError('Bitte den Steuer-Modus bewusst auswählen.'); return; }
    if (!customerId || !name.trim() || nativeLines.some((line, index) => !line.description || !lines[index].unitPrice.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0)) {
      setError('Bitte Name, Kunde und alle Leistungspositionen vollständig und mit gültigen Beträgen ausfüllen.'); return;
    }
    setBusy(true);
    try {
      const checked = readServiceBillingPlanInput({ name, customerId: Number(customerId), cadence, anchorDate, taxMode, items: nativeLines });
      await serviceJson('/api/service-billing', {
        method: plan ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(plan ? { id: plan.id, revision: plan.revision } : { cadence: checked.cadence, anchorDate: checked.anchorDate, requestId }), name: checked.name, customerId: checked.customerId, taxMode: checked.taxMode, items: checked.items }),
      });
      // Successful saves already move focus to the refreshed list heading.
      openerRef.current = null;
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Der Serviceplan konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={!busy} className={styles.editorDialog}
      onOpenAutoFocus={() => { openerRef.current = captureServiceDialogOpener(document); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const opener = openerRef.current;
        openerRef.current = null;
        restoreServiceDialogOpener(opener);
      }}>
      <DialogHeader className={styles.editorHeader}><DialogTitle>{plan ? 'Serviceplan bearbeiten' : 'Neuer Serviceplan'}</DialogTitle><DialogDescription>Speichern erstellt noch keine Rechnung.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className={styles.editorForm}>
        <div className={styles.editorScroll}>
          {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{error}<p className="mt-1 text-xs text-muted-foreground">Deine Eingaben bleiben erhalten. Bei einem veralteten Stand: abbrechen, Liste aktualisieren und erneut öffnen.</p></div>}
          <div className={styles.editorLayout}>
          <section className={styles.editorSetup} aria-labelledby="service-plan-setup-heading">
            <h2 id="service-plan-setup-heading">Plan und Kunde</h2>
          <div className={styles.setupFields}>
            <div className="space-y-2"><Label htmlFor="service-plan-name">Planname</Label><Input id="service-plan-name" value={name} onChange={event => setName(event.target.value)} placeholder="z. B. IT-Betreuung Basis" maxLength={200} required disabled={busy} /></div>
            <div className="space-y-2"><Label htmlFor="service-plan-customer">Kunde</Label><select id="service-plan-customer" value={customerId} onChange={event => setCustomerId(event.target.value)} className={SERVICE_SELECT_CLASS} disabled={busy || customersLoading || Boolean(customersError)} required><option value="">{customersLoading ? 'Kunden werden geladen…' : 'Kunden auswählen'}</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select>
              {customersError ? <div role="alert" className="space-y-2 text-xs"><p>{customersError}</p><Button type="button" variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>Kunden erneut laden</Button></div> : !customersLoading && !customers.length ? <p className="text-xs text-muted-foreground">Noch keine Kunden. <Link href="/customers" className="underline underline-offset-4">Zuerst einen Kunden anlegen</Link>.</p> : null}
            </div>
          </div>
          {plan ? <div className={styles.fixedSchedule}><p className="font-medium">{CADENCE_LABELS[plan.cadence]} · Start {serviceDate(plan.anchorDate)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Rhythmus und Start bleiben fest. Änderungen gelten für künftige Entwürfe.</p></div> : <div className={styles.scheduleFields}><div className="space-y-2"><Label htmlFor="service-plan-cadence">Rhythmus</Label><select id="service-plan-cadence" value={cadence} onChange={event => setCadence(event.target.value as ServiceBillingPlanDto['cadence'])} className={SERVICE_SELECT_CLASS} disabled={busy}>{Object.entries(CADENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="space-y-2"><Label htmlFor="service-plan-anchor">Erster Zeitraum ab</Label><Input id="service-plan-anchor" type="date" value={anchorDate} onChange={event => setAnchorDate(event.target.value)} min="1900-01-01" max="9998-12-31" required disabled={busy} /></div></div>}
          <div className="space-y-2"><Label htmlFor="service-plan-tax">Umsatzsteuer</Label><select id="service-plan-tax" value={taxMode} onChange={event => changeTaxMode(event.target.value as ServiceBillingPlanDto['taxMode'] | '')} className={SERVICE_SELECT_CLASS} disabled={busy} required><option value="">Bitte wählen</option><option value="small-business">Kleinunternehmer (§ 19 UStG) · 0 %</option><option value="standard">Regelbesteuerung · Inlandsleistung</option></select></div>
          </section>
          <section className={styles.editorServices} aria-label="Leistungen und Vorschau">
          <fieldset disabled={busy} className={styles.lineEditor}><legend>Leistungen pro Zeitraum</legend>
            {lines.map((line, index) => <div key={index} className={styles.line}>
              <div className={styles.lineHeading}><p className="text-xs font-semibold text-muted-foreground">Position {index + 1}</p><Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, position) => position !== index))} aria-label={`Position ${index + 1} entfernen`}><Trash2 aria-hidden="true" /></Button></div>
              <div className="space-y-2"><Label htmlFor={`service-line-description-${index}`}>Leistungsbeschreibung<span className="sr-only"> {index + 1}</span></Label><Input id={`service-line-description-${index}`} value={line.description} onChange={event => updateLine(index, { description: event.target.value })} maxLength={2000} required /></div>
              <div className={styles.lineFields}><div className="min-w-0 space-y-2"><Label htmlFor={`service-line-quantity-${index}`}>Menge<span className="sr-only"> {index + 1}</span></Label><Input id={`service-line-quantity-${index}`} type="number" inputMode="decimal" min="0.000001" max="1000000" step="0.000001" value={line.quantity} onChange={event => updateLine(index, { quantity: event.target.value })} required /></div><div className="min-w-0 space-y-2"><Label htmlFor={`service-line-unit-${index}`}>Einheit<span className="sr-only"> {index + 1}</span></Label><select id={`service-line-unit-${index}`} className={SERVICE_SELECT_CLASS} value={line.unit} onChange={event => updateLine(index, { unit: event.target.value })}>{!['Pauschal', 'Stunde', 'Stück', 'Tag'].includes(line.unit) && <option value={line.unit}>{line.unit}</option>}{['Pauschal', 'Stunde', 'Stück', 'Tag'].map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></div><div className="min-w-0 space-y-2"><Label htmlFor={`service-line-price-${index}`}>Netto-Preis<span className="sr-only"> {index + 1}</span> (€)</Label><Input id={`service-line-price-${index}`} type="number" inputMode="decimal" min="0" max="9999999.99" step="0.01" value={line.unitPrice} onChange={event => updateLine(index, { unitPrice: event.target.value })} required /></div><div className="min-w-0 space-y-2"><Label htmlFor={`service-line-tax-${index}`}>USt.<span className="sr-only"> {index + 1}</span></Label><select id={`service-line-tax-${index}`} className={SERVICE_SELECT_CLASS} value={line.taxRate} onChange={event => updateLine(index, { taxRate: Number(event.target.value), taxCategory: 'S', exemptionReason: undefined })} disabled={taxMode !== 'standard'}>{taxMode !== 'standard' || line.taxRate === 0 ? <option value="0">0 %</option> : null}{taxMode === 'standard' && <><option value="7">7 %</option><option value="19">19 %</option></>}</select></div></div>
              {taxMode === 'standard' && line.taxRate === 0 && <p className="text-xs text-muted-foreground">Vorhandener Sonderfall {line.taxCategory}: {line.exemptionReason || 'Begründung fehlt'}. Es wird keine neue Steuerbefreiung abgeleitet; bitte fachlich prüfen.</p>}
            </div>)}
            <Button type="button" variant="outline" disabled={lines.length >= 50} onClick={() => setLines(current => [...current, { ...blankLine(), taxRate: taxMode === 'standard' ? 19 : 0, taxCategory: taxMode === 'standard' ? 'S' : 'E' }])}><Plus aria-hidden="true" />Position ergänzen</Button>
            {lines.length < 50 && <ServiceArticlePicker onSelect={article => setLines(current => {
              const next: LineDraft = { ...article, quantity: '1', unitPrice: article.unitPrice.toFixed(2), taxRate: taxMode === 'standard' ? 19 : 0, taxCategory: taxMode === 'standard' ? 'S' : 'E' };
              return current.length === 1 && !current[0].description.trim() && !current[0].unitPrice.trim() ? [next] : [...current, next];
            })} />}
          </fieldset>
          <div className={styles.editorTotal}><p className="text-sm">Vorschau pro Zeitraum <span className="block text-xs text-muted-foreground">EUR</span></p><p className="text-xl font-semibold tabular-nums">{total === null ? '—' : serviceCurrency(total)}</p></div>
          </section>
          </div>
        </div>
        <DialogFooter className={styles.editorFooter}><Button type="button" variant="outline" onClick={onClose} disabled={busy}>Abbrechen</Button><Button type="submit" disabled={busy || customersLoading || Boolean(customersError) || !customers.length}>{busy && <Loader2 className="animate-spin" aria-hidden="true" />}{busy ? 'Wird gespeichert…' : 'Serviceplan speichern'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
