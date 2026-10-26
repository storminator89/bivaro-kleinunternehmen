export type ComboboxOption = {
  value: string;
  kind: 'existing' | 'custom';
};

export type ComboboxHighlight = {
  index: number;
  options: ComboboxOption[];
  value: string;
};

/** Never reinterpret a previous index after an external value/result change. */
export function comboboxHighlightedIndex(highlight: ComboboxHighlight | null, options: ComboboxOption[], value: string): number {
  if (!highlight || highlight.options !== options || highlight.value !== value) return -1;
  return highlight.index >= 0 && highlight.index < options.length ? highlight.index : -1;
}

/** One ordered model for pointer selection, keyboard navigation and ARIA IDs. */
export function comboboxOptions(options: string[], input: string, allowCustom: boolean): ComboboxOption[] {
  const term = input.trim();
  const search = term.toLowerCase();
  const uniqueOptions = [...new Set(options)];
  const filtered = search ? uniqueOptions.filter(option => option.toLowerCase().includes(search)) : uniqueOptions;
  const rows: ComboboxOption[] = filtered.map(value => ({ value, kind: 'existing' }));
  if (allowCustom && term && !filtered.some(option => option.toLowerCase() === search)) {
    rows.push({ value: term, kind: 'custom' });
  }
  return rows;
}

export function nextComboboxIndex(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0 || current >= count) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}
