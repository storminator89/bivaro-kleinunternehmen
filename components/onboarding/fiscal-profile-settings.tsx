"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readFiscalProfile, validateFiscalProfileInput } from '@/lib/fiscal-profile';
import type { FiscalProfile, FiscalProfileSelection, FiscalTaxRegime } from '@/lib/fiscal-profile';
import { fiscalSelectionPayload, isFiscalSelectionChanged } from './setup-state';
import styles from './onboarding.module.css';

const choices: { value: FiscalTaxRegime; title: string; description: string }[] = [
  { value: 'SMALL_BUSINESS', title: 'Kleinunternehmerregelung (§ 19 UStG)', description: 'Ich habe geklärt, dass ich die Kleinunternehmerregelung anwende. Für passende Umsätze wird keine Umsatzsteuer ausgewiesen.' },
  { value: 'STANDARD', title: 'Regelbesteuerung', description: 'Ich habe geklärt, dass ich nicht die Kleinunternehmerregelung anwende. Steuersatz und Behandlung prüfe ich für jeden Beleg.' },
  { value: 'UNSET', title: 'Noch nicht geklärt', description: 'Ich möchte die Einordnung zuerst klären. Bivaro trifft keine Auswahl für mich.' },
];

export function FiscalProfileSettings({ initialProfile }: { initialProfile: FiscalProfile }) {
  const [saved, setSaved] = useState(initialProfile);
  const [selection, setSelection] = useState<FiscalProfileSelection>({ fiscalTaxRegime: initialProfile.fiscalTaxRegime, fiscalEffectiveFrom: initialProfile.fiscalEffectiveFrom });
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const changed = isFiscalSelectionChanged(saved, selection);

  useEffect(() => {
    if (!changed) return;
    const warnBeforeReload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeReload);
    return () => window.removeEventListener('beforeunload', warnBeforeReload);
  }, [changed]);

  function cancel() {
    setSelection({ fiscalTaxRegime: saved.fiscalTaxRegime, fiscalEffectiveFrom: saved.fiscalEffectiveFrom });
    setConfirmed(false);
    setErrors({});
    setMessage('Änderungen verworfen. Das gespeicherte Steuerprofil bleibt unverändert.');
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const payload = fiscalSelectionPayload(selection);
    const validation = validateFiscalProfileInput({ ...payload });
    const fieldErrors = validation.ok ? {} : validation.fieldErrors;
    if (payload.fiscalTaxRegime !== 'UNSET' && !confirmed) fieldErrors.confirmation = 'Bitte bestätigen Sie Ihre bewusst gewählte Einordnung.';
    setErrors(fieldErrors);
    setMessage('');
    if (Object.keys(fieldErrors).length) return;
    setSaving(true);
    try {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setErrors({ ...(data?.fieldErrors || {}), save: data?.error || 'Das Steuerprofil konnte nicht gespeichert werden. Bitte erneut versuchen.' });
        return;
      }
      const profile = data ? readFiscalProfile(data) : null;
      if (!profile || profile.fiscalTaxRegime !== payload.fiscalTaxRegime || profile.fiscalEffectiveFrom !== payload.fiscalEffectiveFrom) {
        setErrors({ save: 'Die Speicherung konnte nicht bestätigt werden. Bitte laden Sie die Seite neu und prüfen Sie das Steuerprofil.' });
        return;
      }
      setSaved(profile);
      setSelection({ fiscalTaxRegime: profile.fiscalTaxRegime, fiscalEffectiveFrom: profile.fiscalEffectiveFrom });
      setConfirmed(false);
      setMessage(profile.fiscalTaxRegime === 'UNSET' ? 'Steuerprofil zurückgesetzt. Die steuerliche Einordnung ist offen.' : 'Steuerprofil gespeichert. Bestehende Rechnungen bleiben unverändert.');
    } catch {
      setErrors({ save: 'Keine Verbindung zum Server. Ihre Auswahl bleibt hier erhalten; bitte erneut speichern.' });
    } finally {
      setSaving(false);
    }
  }

  return <section id="fiscal-profile" className={styles.panel} aria-labelledby="fiscal-profile-title">
    <header className={styles.header}>
      <div><h2 id="fiscal-profile-title">Ihr Steuerprofil</h2><p>Wählen Sie bewusst, wie Sie umsatzsteuerlich eingeordnet sind. „Kleingewerbe“ bedeutet nicht automatisch Kleinunternehmer nach § 19 UStG.</p></div>
    </header>
    <form onSubmit={save} className={styles.body} noValidate>
      <fieldset disabled={saving} aria-describedby="fiscal-boundaries">
        <legend className={styles.legend}>Welche Einordnung haben Sie geklärt?</legend>
        <div className={styles.options}>
          {choices.map(choice => <label key={choice.value} className={styles.option}>
            <input type="radio" name="fiscalTaxRegime" value={choice.value} checked={selection.fiscalTaxRegime === choice.value}
              aria-invalid={Boolean(errors.fiscalTaxRegime)} aria-describedby={errors.fiscalTaxRegime ? 'fiscal-regime-error' : undefined}
              onChange={() => { setSelection(previous => ({ fiscalTaxRegime: choice.value, fiscalEffectiveFrom: choice.value === 'UNSET' ? null : previous.fiscalEffectiveFrom })); setConfirmed(false); setErrors({}); setMessage(''); }} />
            <span><strong>{choice.title}</strong><span>{choice.description}</span></span>
          </label>)}
        </div>
        {errors.fiscalTaxRegime && <p id="fiscal-regime-error" className={styles.error}>{errors.fiscalTaxRegime}</p>}
        {selection.fiscalTaxRegime !== 'UNSET' && <>
          <div className={styles.date}>
            <label htmlFor="fiscalEffectiveFrom">Gültig ab</label>
            <Input id="fiscalEffectiveFrom" name="fiscalEffectiveFrom" type="date" min="1900-01-01" value={selection.fiscalEffectiveFrom ?? ''}
              aria-invalid={Boolean(errors.fiscalEffectiveFrom)} aria-describedby="fiscal-date-help fiscal-date-error"
              onChange={event => { setSelection(previous => ({ ...previous, fiscalEffectiveFrom: event.target.value || null })); setConfirmed(false); setErrors({}); setMessage(''); }} />
            <p id="fiscal-date-help" className={styles.description}>Ab welchem Datum gilt Ihre geklärte Einordnung? Das ist nicht automatisch Ihr Gründungsdatum.</p>
            <p id="fiscal-date-error" className={styles.error}>{errors.fiscalEffectiveFrom}</p>
          </div>
          <label className={styles.confirmation}>
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} aria-invalid={Boolean(errors.confirmation)} aria-describedby={errors.confirmation ? 'fiscal-confirmation-error' : undefined} />
            <span>Ich bestätige meine Auswahl und das Gültigkeitsdatum. Bivaro prüft meine steuerlichen Voraussetzungen nicht.</span>
          </label>
          {errors.confirmation && <p id="fiscal-confirmation-error" className={styles.error}>{errors.confirmation}</p>}
        </>}
      </fieldset>
      <div className={styles.notice} id="fiscal-boundaries"><strong>Ihre Einordnung, keine automatische Steuerprüfung</strong>Bivaro bietet keine Steuerberatung und ermittelt weder Ihre Berechtigung noch einen Wechsel automatisch. Das Profil ist eine Vorgabe für neue Rechnungen ab dem Gültigkeitsdatum, keine Änderung alter Belege. Sonderfälle und passende Steuersätze müssen Sie gesondert prüfen. <Link className={styles.link} href="/help#steuerprofil">Einordnung und Grenzen verstehen</Link></div>
      <p className={styles.status}>Gespeichert: {saved.fiscalTaxRegime === 'UNSET' ? 'Noch nicht geklärt' : `${saved.fiscalTaxRegime === 'SMALL_BUSINESS' ? 'Kleinunternehmerregelung (§ 19 UStG)' : 'Regelbesteuerung'} · gültig ab ${saved.fiscalEffectiveFrom?.split('-').reverse().join('.')}`}. {saved.fiscalConfirmedAt && 'Von Ihnen bestätigt; keine fachliche Prüfung durch Bivaro.'}</p>
      <div aria-live="polite" aria-atomic="true">{message && <p className={styles.status}>{message}</p>}</div>
      {Object.keys(errors).length > 0 && <p role="alert" className={styles.error}>{errors.save || 'Das Steuerprofil wurde nicht gespeichert. Bitte prüfen Sie die markierten Angaben.'}</p>}
      <div className={styles.actions}>
        <p>{changed ? 'Ungespeicherte Änderungen' : 'Keine ungespeicherten Änderungen'}</p>
        <Button type="button" variant="outline" onClick={cancel} disabled={saving || (!changed && !confirmed)}>Verwerfen</Button>
        <Button type="submit" disabled={saving || !changed}>{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{saving ? 'Wird gespeichert…' : selection.fiscalTaxRegime === 'UNSET' ? 'Einordnung zurücksetzen' : 'Steuerprofil speichern'}</Button>
      </div>
    </form>
  </section>;
}
