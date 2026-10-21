import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { FiscalProfile } from '@/lib/fiscal-profile';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: unknown) => {
      hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next;
    }];
  },
}));
import { FiscalProfileSettings } from '@/components/onboarding/fiscal-profile-settings';

type Element = ReactElement<Record<string, unknown>>;
const unknownProfile: FiscalProfile = { fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null, fiscalConfirmedAt: null };
const storedProfile: FiscalProfile = { fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01', fiscalConfirmedAt: '2026-10-20T20:00:00.000Z' };
let initial = unknownProfile;
let fetchMock = vi.fn();

function elements(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children as ReactNode, predicate)];
}
function render() { hooks.cursor = 0; return FiscalProfileSettings({ initialProfile: initial }); }
function field(predicate: (element: Element) => boolean) { return elements(render(), predicate)[0]; }
function select(value: string) { (field(element => element.props.type === 'radio' && element.props.value === value).props.onChange as () => void)(); }
function date(value: string) { (field(element => element.props.id === 'fiscalEffectiveFrom').props.onChange as (event: unknown) => void)({ target: { value } }); }
function confirm() { (field(element => element.props.type === 'checkbox').props.onChange as (event: unknown) => void)({ target: { checked: true } }); }
async function submit() { await (field(element => element.type === 'form').props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() }); }
function content(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<{ children?: ReactNode }>(node) ? content(node.props.children) : '';
}
function textIncludes(value: string) { return content(render()).includes(value); }
function response(profile: FiscalProfile) { return { ok: true, json: async () => profile }; }

beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; initial = unknownProfile;
  fetchMock = vi.fn().mockResolvedValue(response(storedProfile));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('fiscal profile form controlled behavior', () => {
  it('does not save a selected profile without a valid date or explicit confirmation', async () => {
    select('STANDARD');
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field(element => element.props.id === 'fiscalEffectiveFrom').props['aria-invalid']).toBe(true);
    date('2026-01-01');
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field(element => element.props.type === 'checkbox').props['aria-invalid']).toBe(true);
  });
  it('sends only declared fields and replaces the saved baseline after a confirmed response', async () => {
    select('STANDARD'); date('2026-01-01'); confirm();
    await submit();
    expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fiscalTaxRegime: 'STANDARD', fiscalEffectiveFrom: '2026-01-01' }) }));
    expect(field(element => element.props.type === 'submit').props.disabled).toBe(true);
    expect(textIncludes('Steuerprofil gespeichert')).toBe(true);
    expect(field(element => element.props.type === 'checkbox').props.checked).toBe(false);
  });
  it('retains unsaved input and inline server field errors after a failed save', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Bitte prüfen.', fieldErrors: { fiscalEffectiveFrom: 'Ungültiges Datum.' } }) });
    select('STANDARD'); date('2026-01-01'); confirm(); await submit();
    expect(field(element => element.props.id === 'fiscalEffectiveFrom').props.value).toBe('2026-01-01');
    expect(field(element => element.props.id === 'fiscalEffectiveFrom').props['aria-invalid']).toBe(true);
    expect(textIncludes('Ungespeicherte Änderungen')).toBe(true);
    expect(textIncludes('Gespeichert: ')).toBe(true);
    expect(textIncludes('Noch nicht geklärt')).toBe(true);
  });
  it('retains input across a network failure and permits retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    select('STANDARD'); date('2026-01-01'); confirm(); await submit();
    expect(textIncludes('Keine Verbindung zum Server')).toBe(true);
    expect(field(element => element.props.type === 'submit').props.disabled).toBe(false);
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(textIncludes('Steuerprofil gespeichert')).toBe(true);
  });
  it('does not call an unconfirmed or mismatching response saved', async () => {
    fetchMock.mockResolvedValue(response({ ...storedProfile, fiscalEffectiveFrom: '2025-01-01' }));
    select('STANDARD'); date('2026-01-01'); confirm(); await submit();
    expect(textIncludes('Die Speicherung konnte nicht bestätigt werden')).toBe(true);
    expect(textIncludes('Ungespeicherte Änderungen')).toBe(true);
  });
  it('cancels to the actual saved profile rather than selecting a new default', () => {
    initial = storedProfile;
    select('SMALL_BUSINESS'); date('2027-01-01'); confirm();
    (field(element => element.props.children === 'Verwerfen').props.onClick as () => void)();
    expect(field(element => element.props.value === 'STANDARD').props.checked).toBe(true);
    expect(field(element => element.props.id === 'fiscalEffectiveFrom').props.value).toBe('2026-01-01');
    expect(field(element => element.props.type === 'checkbox').props.checked).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('resets a previously confirmed profile only with explicit save and a null date', async () => {
    initial = storedProfile;
    select('UNSET');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response(unknownProfile));
    await submit();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fiscalTaxRegime: 'UNSET', fiscalEffectiveFrom: null });
    expect(textIncludes('Steuerprofil zurückgesetzt')).toBe(true);
  });
  it('disables editing and ignores another submit while a save is pending', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    select('STANDARD'); date('2026-01-01'); confirm();
    const pending = submit();
    expect(field(element => element.type === 'fieldset').props.disabled).toBe(true);
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(response(storedProfile)); await pending;
    expect(field(element => element.type === 'fieldset').props.disabled).toBe(false);
  });
});
