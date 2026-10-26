import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PilotDemo } from '@/components/public-accounting/pilot-demo';
import { createPilotDemoWorksheet, formatPilotDemoAmount, pilotDemo, pilotDemoBalances, pilotDemoLimits, pilotDemoSteps } from '@/lib/pilot-demo';

const html = () => renderToStaticMarkup(createElement(PilotDemo));

describe('bounded synthetic pilot walkthrough', () => {
  it('keeps exactly the agreed five steps, in order, with unique direct links and a next task', () => {
    expect(pilotDemoSteps.map(step => step.id)).toEqual([
      'demo-rechnung', 'demo-teilzahlung', 'demo-beleg', 'demo-korrektur', 'demo-uebergabe',
    ]);
    const rendered = html();
    for (const step of pilotDemoSteps) {
      expect(rendered).toContain(`href="#${step.id}"`);
      expect(rendered.match(new RegExp(`id="${step.id}"`, 'g'))).toHaveLength(1);
      expect(rendered).toContain(`aria-labelledby="${step.id}-title"`);
      expect(rendered).toContain(`id="${step.id}-title"`);
      expect(rendered).toContain(`href="${step.guideHref}"`);
    }
    expect(rendered).toContain('href="#umstieg"');
    expect(rendered).toContain('Nächster Schritt: Umstieg vorbereiten');
  });

  it('uses integer-cent arithmetic and keeps correction, open debt and expense separate', () => {
    const balances = pilotDemoBalances();
    for (const value of [pilotDemo.invoiceCents, pilotDemo.recordedPaymentCents, pilotDemo.neverReceivedCents, pilotDemo.expenseCents, ...Object.values(balances)]) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(balances).toEqual({ initiallyOpenCents: 20_000, validReceivedCents: 8_000, correctedOpenCents: 22_000 });
    expect(balances.validReceivedCents + pilotDemo.neverReceivedCents).toBe(pilotDemo.recordedPaymentCents);
    expect(balances.validReceivedCents + balances.correctedOpenCents).toBe(pilotDemo.invoiceCents);
    expect(balances.correctedOpenCents - balances.initiallyOpenCents).toBe(pilotDemo.neverReceivedCents);
    expect(formatPilotDemoAmount(pilotDemo.expenseCents)).toBe('40,00 EUR');
    expect(pilotDemoSteps[2].story).toContain('mindert nicht den offenen Rechnungsbetrag');
    expect(pilotDemoSteps[4].result).toContain('nicht zu einer Einnahmensumme addieren');
  });

  it('never teaches a refund, reassignment or original overwrite as a never-received correction', () => {
    const correction = pilotDemoSteps[3];
    expect(correction.story).toContain('20,00 EUR nie eingegangen');
    expect(correction.story).toContain('nicht um Geld auf einer anderen Rechnung');
    expect(correction.story).toContain('nicht um eine Rückzahlung');
    expect(correction.action).toContain('Korrektur / Erstattung dokumentieren → Korrektur');
    expect(correction.result).toContain('80,00 EUR gültig eingegangen, 220,00 EUR noch offen');
    expect(correction.caution).toContain('Original nicht überschreiben');
    expect(correction.caution).toContain('ursprünglichen Zahlungstag');
    expect(correction.caution).toContain('Entdeckungsdatum bleibt getrennt');
    expect(correction.caution).toContain('tatsächlich bereits zurückgezahltes Geld');
    expect(correction.caution).toContain('vollständigen Stornobezug');
    expect(correction.caution).toContain('nie eine Überweisung');
    expect(correction.caution).toContain('EÜR-/Steuerausgaben können gesperrt sein');
    expect(pilotDemoSteps[4].caution).toContain('UNREVIEWED');
  });

  it('ships the exact deterministic public worksheet with a version and source, not an accepted-build claim', () => {
    const text = createPilotDemoWorksheet();
    expect(readFileSync(resolve(process.cwd(), `public${pilotDemo.worksheetHref}`), 'utf8')).toBe(text);
    expect(text).toBe(createPilotDemoWorksheet());
    expect(text).toContain(`Erklärblatt-Version ${pilotDemo.version} · Quellreferenz ${pilotDemo.sourceRef}`);
    expect(text).toContain('nicht einen abgenommenen Build');
    expect(text).toContain('Kein aus einem abgenommenen Build erzeugtes PDF');
    expect(text).toContain('Kein Importformat');
    expect(text).toContain(pilotDemoLimits);
    for (const id of [pilotDemo.invoiceId, pilotDemo.paymentId, pilotDemo.receiptId, pilotDemo.correctionId]) {
      expect(id).toMatch(/^SYN-DEMO-[A-Z]{2}-001$/);
      expect(text).toContain(id);
    }
    expect(text).not.toMatch(/mailto:|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b|api[_-]?key|BEGIN .*PRIVATE KEY|@/i);
  });

  it('renders correction and handoff safety caveats outside every optional disclosure', () => {
    const rendered = html();
    for (const step of [pilotDemoSteps[3], pilotDemoSteps[4]]) {
      const section = rendered.match(new RegExp(`<section id="${step.id}"[^>]*>([\\s\\S]*?)</section>`))?.[1];
      expect(section).toBeDefined();
      const alwaysVisible = section!.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
      expect(alwaysVisible).toContain(step.caution);
      expect(alwaysVisible).not.toMatch(/\bhidden(?:=|\s|>)/);
    }
    expect(rendered).toContain('<summary>Worauf Sie achten sollten: Teilzahlung erfassen</summary>');
    expect(rendered).toContain('<summary>Synthetischen Textbeleg ansehen</summary>');
  });

  it('keeps the worksheet text, download and matching receipt return available without demo JavaScript', () => {
    const rendered = html();
    expect(rendered).toContain(`href="${pilotDemo.worksheetHref}" download="bivaro-pilot-v1.txt"`);
    expect(rendered).toContain('<pre');
    expect(rendered).toContain('SYNTHETISCHES ERKLÄRBLATT');
    expect(rendered).toContain('Erfundener Textbeleg · keine echte Rechnung');
    expect(rendered).toContain('Zurück zum Schritt „Ausgabe mit Beleg verbinden“');
    expect(rendered).not.toMatch(/<form\b|<input\b|<select\b|<button\b|<img\b|<video\b|href="\/(?:login|register|api)\b/i);
    const source = readFileSync(resolve(process.cwd(), 'components/public-accounting/pilot-demo.tsx'), 'utf8');
    expect(source).not.toMatch(/['"]use client['"]|\bfetch\s*\(|localStorage|sessionStorage|useEffect|useState|navigator\./);
  });

  it('retains real public help/checklist destinations and adds no protected or dead-end demo action', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/help/page.tsx'), 'utf8');
    expect(page).toContain('<PilotDemo />');
    expect(page).toContain('<SwitchingChecklist />');
    expect(page).toContain('id="demo"');
    expect(page).toContain('href="#demo"');
    for (const step of pilotDemoSteps) {
      const target = step.guideHref.slice(1);
      const guides = readFileSync(resolve(process.cwd(), 'components/public-accounting/pilot-guides.ts'), 'utf8');
      expect(page.includes(`id="${target}"`) || guides.includes(`id: '${target}'`)).toBe(true);
    }
    const hrefs = [...html().matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(hrefs.every(href => href.startsWith('#') || href === pilotDemo.worksheetHref)).toBe(true);
    expect(page).toContain('<OfferSummary />');
  });

  it('makes unproved models, unsupported cases and external review visibly optional to inspect, never successful by assertion', () => {
    const rendered = html();
    const text = createPilotDemoWorksheet();
    for (const copy of [rendered, text]) {
      expect(copy).toContain('Nicht zugesagte Varianten bleiben Konzept, kein buchbares Angebot');
      expect(copy).toContain('Einrichtung, Updates, Sicherung, Wiederherstellung und Ausstieg');
      expect(copy).toContain('Ausland/Reverse Charge');
      expect(copy).toContain('Anzahlungen/Schlussrechnungen');
      expect(copy).toContain('ungeklärte Altzahlungen');
      expect(copy).toContain('stoppen und fachlich prüfen lassen');
      expect(copy).toContain('Browser-Abnahme und freiwilliger Empfängerreview');
    }
    expect(pilotDemoSteps[4].story).toContain('kein Übergabepaket erzeugt');
  });
});
