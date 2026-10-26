import { describe, expect, it } from 'vitest';
import {
  createSwitchingReview,
  createSwitchingState,
  isSwitchingStatus,
  summarizeSwitchingState,
  switchingReviewLimits,
  switchingStatusLabels,
  switchingStatuses,
  switchingTopics,
  type SwitchingState,
} from '@/lib/switching-checklist';

describe('data-free switching preparation', () => {
  it('covers exactly the six agreed transition topics with distinct controls', () => {
    expect(switchingTopics.map(topic => topic.id)).toEqual([
      'company', 'numbers', 'open-items', 'start-date', 'double-entry', 'control-totals',
    ]);
    expect(Object.keys(createSwitchingState())).toEqual(switchingTopics.map(topic => topic.id));
    expect(new Set(switchingTopics.map(topic => topic.id)).size).toBe(6);
    for (const topic of switchingTopics) {
      expect(topic.title.length).toBeGreaterThan(5);
      expect(topic.task.length).toBeGreaterThan(50);
      expect(topic.evidence.length).toBeGreaterThan(30);
    }
  });

  it('starts open and gives each reset a fresh state without modifying earlier selections', () => {
    const first = createSwitchingState();
    first.company = 'prepared';
    const reset = createSwitchingState();
    expect(reset).not.toBe(first);
    expect(summarizeSwitchingState(reset)).toEqual({ open: 6, prepared: 0, review: 0 });
    expect(first.company).toBe('prepared');
  });

  it.each(switchingStatuses)('accepts only the declared native status value: %s', status => {
    expect(isSwitchingStatus(status)).toBe(true);
    expect(switchingStatusLabels[status]).toBeTruthy();
  });

  it.each([null, undefined, true, 0, {}, [], 'done', 'verified', 'PREPARED', '', '<script>'])('rejects invalid status values: %j', status => {
    expect(isSwitchingStatus(status)).toBe(false);
  });

  it('counts a mixed review without mutating its input or inventing a release flag', () => {
    const state = Object.freeze({
      company: 'prepared', numbers: 'prepared', 'open-items': 'review',
      'start-date': 'open', 'double-entry': 'review', 'control-totals': 'open',
    } satisfies SwitchingState);
    expect(summarizeSwitchingState(state)).toEqual({ open: 2, prepared: 2, review: 2 });
    expect(state['open-items']).toBe('review');
    expect(Object.keys(summarizeSwitchingState(state)).sort()).toEqual(['open', 'prepared', 'review']);
  });

  it('exports the exact current self-assessment, all six tasks and unfilled manual fields', () => {
    const state = createSwitchingState();
    state.company = 'prepared';
    state['open-items'] = 'review';
    const text = createSwitchingReview(state);
    expect(text).toContain('Selbst vorbereitet: 1 von 6 · Noch offen: 4 · Prüfbedarf: 1');
    expect(text).toContain('1. Firma und Zuständigkeit: Selbst vorbereitet');
    expect(text).toContain('3. Offene Posten: Prüfbedarf');
    for (const topic of switchingTopics) {
      expect(text).toContain(topic.task);
      expect(text).toContain(topic.evidence);
    }
    expect(text).toContain('Tatsächlich geprüfte Installation / Build-Version: ____________________');
    expect(text).toContain('Kanzlei-Review, Datum und Ergebnis (nur selbst ergänzen): ____________________');
    expect(text.match(/Review \/ offene Frage \/ verantwortliche Stelle:/g)).toHaveLength(6);
    expect(text).not.toMatch(/mailto:|https?:|Demo GmbH|API.?Key|Authentifizierungstoken/i);
  });

  it('never turns all prepared marks into an independent approval or demo/build claim', () => {
    const state = createSwitchingState();
    for (const topic of switchingTopics) state[topic.id] = 'prepared';
    const text = createSwitchingReview(state);
    expect(text).toContain('Selbst vorbereitet: 6 von 6');
    expect(text).toContain(switchingReviewLimits);
    expect(text).toContain('Auch bei sechs vorbereiteten Punkten bleibt der externe Review offen.');
    expect(text).toContain('Dies ist keine geführte Produktdemo.');
    expect(text).toContain('ist gesondert nachzuweisen');
    expect(text).toContain('ein Demo-Erfolg ist keine Produktfreigabe');
  });

  it('keeps operating models comparable and non-supported cases explicitly unapproved', () => {
    const text = createSwitchingReview(createSwitchingState());
    expect(text).toContain('[ ] Selbstbetrieb [ ] betreute Instanz [ ] SaaS [ ] noch offen');
    expect(text).toContain('Nicht zugesagte Varianten bleiben Konzept, kein buchbares Angebot.');
    for (const phrase of ['Ausland/Reverse Charge', 'Anzahlungen/Schlussrechnungen', 'Erstattungen', 'Kassenbetriebe', 'gemeinsame Firmenzugänge', 'vollständige Regelbesteuerung']) {
      expect(text).toContain(phrase);
    }
    expect(text).toContain('nicht als freigegeben behandeln');
    expect(text).toContain('manuell und freiwillig weitergeben');
  });

  it('exports deterministically without timestamps, account context or additional mutations', () => {
    const state = Object.freeze(createSwitchingState());
    expect(createSwitchingReview(state)).toBe(createSwitchingReview(state));
    expect(summarizeSwitchingState(state)).toEqual({ open: 6, prepared: 0, review: 0 });
  });
});
