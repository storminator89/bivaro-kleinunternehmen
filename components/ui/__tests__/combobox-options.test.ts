import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Combobox } from '../combobox';
import { comboboxHighlightedIndex, comboboxOptions, nextComboboxIndex } from '../combobox-options';

const options = ['Bürobedarf', 'Büromiete', 'Telefon'];

describe('shared combobox selectable model', () => {
  it('includes the same existing and custom choices in display/navigation order', () => {
    expect(comboboxOptions(options, '  Büro  ', true)).toEqual([
      { kind: 'existing', value: 'Bürobedarf' },
      { kind: 'existing', value: 'Büromiete' },
      { kind: 'custom', value: 'Büro' },
    ]);
  });

  it('does not offer duplicate case-insensitive exact values or whitespace-only creation', () => {
    expect(comboboxOptions(options, '  BÜROBEDARF ', true)).toEqual([{ kind: 'existing', value: 'Bürobedarf' }]);
    expect(comboboxOptions(options, '  ', true)).toEqual(options.map(value => ({ kind: 'existing', value })));
  });

  it('provides one custom row with no matches and no invented row when creation is disabled', () => {
    expect(comboboxOptions(options, 'Neu', true)).toEqual([{ kind: 'custom', value: 'Neu' }]);
    expect(comboboxOptions(options, 'Neu', false)).toEqual([]);
    expect(comboboxOptions([], '', true)).toEqual([]);
  });

  it('deduplicates repeated strings before assigning keys, IDs and keyboard indices', () => {
    expect(comboboxOptions(['Bürobedarf', 'Bürobedarf', 'Büromiete'], 'Büro', true)).toEqual([
      { kind: 'existing', value: 'Bürobedarf' }, { kind: 'existing', value: 'Büromiete' }, { kind: 'custom', value: 'Büro' },
    ]);
  });

  it('invalidates old highlights synchronously on newer options or external committed values', () => {
    const rows = comboboxOptions(options, 'Büro', true);
    const highlight = { index: 1, options: rows, value: '' };
    expect(comboboxHighlightedIndex(highlight, rows, '')).toBe(1);
    expect(comboboxHighlightedIndex(highlight, comboboxOptions(options, 'Büro', true), '')).toBe(-1);
    expect(comboboxHighlightedIndex(highlight, rows, 'Neuer externer Wert')).toBe(-1);
    expect(comboboxHighlightedIndex({ ...highlight, index: 99 }, rows, '')).toBe(-1);
    expect(comboboxHighlightedIndex(null, rows, '')).toBe(-1);
  });

  it('reaches creation after matches, wraps both directions and opens upwards at the last row', () => {
    const rows = comboboxOptions(options, 'Büro', true);
    let index = -1;
    const visited = Array.from({ length: rows.length }, () => {
      index = nextComboboxIndex(index, rows.length, 1);
      return rows[index];
    });
    expect(visited).toEqual(rows);
    expect(visited.at(-1)).toEqual({ kind: 'custom', value: 'Büro' });
    expect(nextComboboxIndex(index, rows.length, 1)).toBe(0);
    expect(nextComboboxIndex(0, rows.length, -1)).toBe(rows.length - 1);
    expect(nextComboboxIndex(-1, rows.length, -1)).toBe(rows.length - 1);
  });

  it('never points at nonexistent options for empty or changed result sets', () => {
    expect(nextComboboxIndex(0, 0, 1)).toBe(-1);
    expect(nextComboboxIndex(-1, 0, -1)).toBe(-1);
    expect(nextComboboxIndex(8, 2, 1)).toBe(0);
    expect(nextComboboxIndex(8, 2, -1)).toBe(1);
  });
});

describe('combobox initial accessible presentation (not browser interaction proof)', () => {
  it('keeps an explicit label target and omits nonexistent popup/active-descendant references while closed', () => {
    const html = renderToStaticMarkup(createElement(Combobox, { id: 'category', value: '', options, onChange: vi.fn() }));
    expect(html).toContain('id="category"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Vorschläge anzeigen"');
    expect(html).not.toContain('aria-activedescendant=');
    expect(html).not.toContain('aria-controls=');
    expect(html).not.toContain('role="listbox"');
  });

  it('generates unique IDs for multiple comboboxes without supplied IDs', () => {
    const field = () => createElement(Combobox, { value: '', options, onChange: vi.fn() });
    const html = renderToStaticMarkup(createElement('div', null, field(), field()));
    const ids = [...html.matchAll(/<input\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
