import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source-only guard, baseline main 9229ed2. No network, browser or database.
// Sorted multisets allow presentation reordering, but preserve every non-class
// JSX attribute (including handlers, guards, routes, options) and visible copy.
const baseline = {
  "incomes": {
    "bindings": "46b7f287098b8efb2a9743529fa46a19dbef8cb31b437d9672a0090e66912863",
    "count": 281,
    "copy": "10b5ad984da3ef377984f9fcc061327d607169af33d31a4ffa948de21e86b4dd",
    "declarations": {
      "IncomeInvoiceAttribution": "256d75ec60be7480c0ffa3c2f38a9e43a10cc9ad531a3e20a652cebce5af53bf",
      "IncomesTabProps": "3a2e47855b30efd8ede24a8c31fbb4fc26b93c92711701fa7e9dd28505c31757",
      "sort": "bc84f73f64a83223fe96f6284890f037dab7a1cae1176b02155c54a9e463c070",
      "hasFilters": "847389a625562a9843b98c63bb37b0ad5f9bdf569d833e4e743c29fc01cc8508"
    }
  },
  "expenses": {
    "bindings": "c6fdcc33af8c7d2f44c8490a87f6f453c5586200efaf18fff80c22090718d17d",
    "count": 281,
    "copy": "87c1e23d00d14969b81b8b92c24402effaea127958a7047fffa7d3e3aceb697e",
    "declarations": {
      "ExpensesTabProps": "95839357567ad2b213a977e9859e4aaf11ea87bc85bf6ec0e23d1493626c64df",
      "allCategories": "d112a635f6dc4139d2c6d416bc6a4c439c00dfd4a8ec6e33b3b9b273bb64e3e2",
      "sort": "bc84f73f64a83223fe96f6284890f037dab7a1cae1176b02155c54a9e463c070",
      "hasFilters": "15e7d667962364117ce061cc115ac27f9a45dc554982197290f3878b9a466589"
    }
  }
};
const css = readFileSync('components/dashboard/tabs/cashflow-workspace.module.css', 'utf8');
const digest = (s: string) => createHash('sha256').update(s.replace(/\s+/g, ' ')).digest('hex');
for (const kind of ['incomes', 'expenses'] as const) {
  const text = readFileSync(`components/dashboard/tabs/${kind}-tab.tsx`, 'utf8');
  const tree = ts.createSourceFile('tab.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const attrs: string[] = [], copy: string[] = [];
  const declarations: Record<string, string> = {};
  function inspect(n: ts.Node) {
    if (ts.isJsxAttribute(n) && n.name.getText(tree) !== 'className') {
      const element = n.parent.parent;
      if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
        attrs.push(element.tagName.getText(tree) + ':' + n.getText(tree).replace(/\s+/g, ' '));
      }
    }
    if (ts.isJsxText(n) && n.getText(tree).trim()) copy.push(n.getText(tree).trim().replace(/\s+/g, ' '));
    if ((ts.isFunctionDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isVariableDeclaration(n)) && n.name && ['IncomeInvoiceAttribution', 'IncomesTabProps', 'ExpensesTabProps', 'allCategories', 'sort', 'hasFilters'].includes(n.name.getText(tree))) declarations[n.name.getText(tree)] = digest(n.getText(tree));
    ts.forEachChild(n, inspect);
  }
  inspect(tree);
  describe(`${kind} presentation contract`, () => {
    it('preserves all non-presentation bindings and financial declarations', () => {
      expect({ bindings: digest(attrs.sort().join('\n')), count: attrs.length, copy: digest(copy.sort().join('\n')), declarations }).toEqual(baseline[kind]);
    });
    it('keeps the client boundary first and search first in filter DOM order', () => {
      expect(text.trimStart().startsWith('"use client";')).toBe(true);
      const singular = kind === 'incomes' ? 'income' : 'expense';
      expect(text.indexOf(`id="${singular}-search"`)).toBeLessThan(text.indexOf(`id="${singular}-date-filter"`));
    });
    it('removes mobile truncation and adds identity and accounting structure', () => {
      expect(text).not.toContain('truncate font-semibold');
      expect(text).toContain('className={styles.recordHeading}');
      expect(text).toContain('className={styles.entryDescription}');
      expect(text).toContain('className={styles.taxToggle}');
      expect(css).toContain('overflow-wrap: anywhere');
      expect(css).toContain('min-height: 2.75rem');
      expect(css).toContain(':focus-visible');
    });
  });
}
it('makes receipt input keyboard reachable without changing native file binding', () => {
  expect(css).toContain('.fileInput { position: absolute;');
  expect(css).toContain('.attachment:focus-within');
  expect(css).not.toMatch(/\.fileInput[^}]*display:\s*none/);
});
