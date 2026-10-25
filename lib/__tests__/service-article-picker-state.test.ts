import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createArticlePickerScope, readPickerArticles } from '@/components/dashboard/service-article-picker-state';
import { ServiceArticlePicker } from '@/components/dashboard/service-article-picker';

const article = { id: 7, name: 'Synthetic service', description: 'Synthetic catalogue line', unit: 'Stunde',
  unitPriceCents: '12345', sourcePriceCents: '12345', sourcePriceBasis: 'NET' as const, taxRate: '19' };

describe('article picker read generations', () => {
  it('starts closed and permits only the current open read generation', () => {
    const scope = createArticlePickerScope();
    expect(scope.current(0)).toBe(false);
    const request = scope.begin();
    expect(scope.current(request)).toBe(true);
    expect(scope.current(request - 1)).toBe(false);
  });
  it('invalidates an old row click synchronously before the close/reopen React commit', () => {
    const scope = createArticlePickerScope(), old = scope.begin();
    scope.close(); expect(scope.current(old)).toBe(false);
    const fresh = scope.begin();
    expect(scope.current(old)).toBe(false); expect(scope.current(fresh)).toBe(true);
  });
  it('rejects an older reply after an explicit read retry', () => {
    const scope = createArticlePickerScope(), old = scope.begin(), retry = scope.begin();
    expect(retry).toBeGreaterThan(old);
    expect(scope.current(old)).toBe(false); expect(scope.current(retry)).toBe(true);
  });
  it('never revives a disposed read when mounting a later scope generation', () => {
    const scope = createArticlePickerScope(), old = scope.begin();
    scope.dispose(); expect(scope.current(old)).toBe(false);
    scope.mount(); expect(scope.current(old)).toBe(false);
    expect(scope.current(scope.begin())).toBe(true);
  });
});

describe('fresh article payload contract', () => {
  it('keeps exact net cents, source tax and explicit empty results unchanged', () => {
    expect(readPickerArticles([article])).toEqual([article]);
    expect(readPickerArticles([])).toEqual([]);
  });
  it.each([null, {}, { error: 'Synthetic interruption' }, [article, { ...article, unitPriceCents: 'NaN' }], [{ ...article, sourcePriceCents: '5' }]])('fails closed instead of exposing old or partially valid prices for %j', value => {
    expect(() => readPickerArticles(value)).toThrow('Ungültiger Artikelkatalog');
  });
  it('does not fetch or expose cached selectable rows in the initial static closed presentation', () => {
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(createElement(ServiceArticlePicker, { onSelect }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Aus Artikelkatalog übernehmen');
    expect(html).not.toContain('als Position übernehmen');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
