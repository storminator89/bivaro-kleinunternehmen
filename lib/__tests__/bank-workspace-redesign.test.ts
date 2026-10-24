import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BankCsvPreviewRowCard, BankCsvWorkspace } from '@/components/bank-csv/bank-csv-workspace';
import { BankImportReceiptSummary } from '@/components/bank-csv/bank-import-panel';
import { buildBankCsvPreview, inferBankCsvMapping, parseBankCsv } from '@/lib/bank-csv';
import type { BankImportReceipt } from '@/lib/bank-import-contract';
import styles from '@/components/bank-csv/bank-workspace.module.css';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'synthetic-redesign-tenant' } } }) }));

function bankRow() {
  const csv = parseBankCsv('Datum;Betrag;Währung;Gegenpartei;Verwendungszweck\n21.10.2026;40,00;EUR;Werkstatt;RE-120');
  return buildBankCsvPreview(csv, { ...inferBankCsvMapping(csv.headers), accountAlias: 'Testkonto' }).rows[0];
}
function receipt(): BankImportReceipt {
  return {
    version: 1, id: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222',
    savedAt: '2026-10-24T12:00:00.000Z', accountAlias: '<script>Testkonto</script>', sourceSha256: 'a'.repeat(64),
    sourceBytes: 100, parserVersion: 'bank-csv-v1', mappingVersion: 'bank-csv-mapping-v1', evidenceSha256: 'b'.repeat(64),
    counts: { total: 3, valid: 2, invalid: 1, incoming: 1, outgoing: 1, duplicates: 1, overlapRows: 1 },
    totals: { incomingCents: '4000', outgoingCents: '505', netCents: '3495' },
    period: { from: '2026-10-21', to: '2026-10-24' }, sameFilePreviouslySaved: true,
    mappingProfile: { id: '33333333-3333-4333-8333-333333333333', name: 'Synthetisches Profil', revision: 7 },
  };
}

describe('bank import workbench presentation contracts', () => {
  it('keeps native source selection and optional profiles in distinct sibling regions', () => {
    const html = renderToStaticMarkup(createElement(BankCsvWorkspace));
    expect(html).toContain(`class="${styles.fileLayout}"`);
    expect(html).toContain(`class="${styles.profiles}"`);
    expect(html.indexOf('id="bank-file"')).toBeLessThan(html.indexOf('Zuordnungsprofile'));
    expect(html).toContain('aria-describedby="bank-file-help"');
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('transition-all');
  });

  it('keeps each ledger record named, exact and read-only with separate date and amount regions', () => {
    const html = renderToStaticMarkup(createElement(BankCsvPreviewRowCard, {
      row: { ...bankRow(), amountCents: '9007199254740993', counterparty: 'Konto'.repeat(40), reference: '<img src=x onerror=alert(1)>' },
      candidates: null,
    }));
    expect(html).toContain('aria-label="Bankzeile 2"');
    expect(html).toContain(`class="${styles.rowMeta}"`);
    expect(html).toContain(`class="${styles.entryAmount}"`);
    expect(html).toContain('90.071.992.547.409,93 €');
    expect(html).toContain('21.10.2026');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<button');
  });

  it('keeps receipt control totals independent from immutable hash and profile revision evidence', () => {
    const value = receipt();
    const html = renderToStaticMarkup(createElement(BankImportReceiptSummary, { receipt: value }));
    expect(html).toContain(`class="${styles.controlTotals} ${styles.receiptTotals}"`);
    expect(html).toContain('40,00 €');
    expect(html).toContain('5,05 €');
    expect(html).toContain(`dateTime="${value.savedAt}"`);
    expect(html).toContain('Import gespeichert, noch keine Zahlungen zugeordnet');
    expect(html).toContain('Alle importierten Zeilen bleiben unverändert erhalten.');
    expect(html).toContain('Keine bestehende Quittung wurde verändert.');
    expect(html).toContain('Synthetisches Profil');
    expect(html).toContain('Revision 7');
    expect(html).toContain(value.sourceSha256);
    expect(html).toContain(value.evidenceSha256);
    expect(html).toContain('&lt;script&gt;Testkonto&lt;/script&gt;');
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('<button');
  });

  it('never calls a saved receipt unallocated when the live assignment count is unknown or nonzero', () => {
    for (const assignmentCount of [null, 1]) {
      const html = renderToStaticMarkup(createElement(BankImportReceiptSummary, { receipt: receipt(), assignmentCount }));
      expect(html).toContain('Zuordnungen separat prüfen');
      expect(html).not.toContain('noch keine Zahlungen zugeordnet');
    }
  });
});


describe('saved bank-history presentation boundaries', () => {
  const historySource = readFileSync(new URL('../../components/bank-csv/bank-import-panel.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('../../components/bank-csv/bank-workspace.module.css', import.meta.url), 'utf8');

  it('gives reopened allocation rows their own width container instead of relying on the preview ledger', () => {
    expect(historySource).toContain('<ol className={`${styles.entryList} ${styles.historyEntries}`}>{detail.rowEnvelopes.map');
    expect(cssSource).toMatch(/\.ledger,\s*\.historyEntries\s*\{\s*container-type:\s*inline-size;/);
    expect(cssSource).toContain('@container (min-width: 36rem)');
    expect(cssSource).toMatch(/\.saveRail \.receiptMeta\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('suppresses the initial loading live region after a history error while preserving the retry control', () => {
    expect(historySource).toContain('{!history ? !error && <div role="status" className={styles.historyState}>');
    expect(historySource).toContain('Verlauf erneut laden');
    expect(historySource).toContain('onClick={() => setReload(value => value + 1)}');
  });
});


function bankSourceContracts(text: string) {
  const tree = ts.createSourceFile('fixture.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings: string[] = [], logic: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && /^(on[A-Z].*|href|name|type|key|value|defaultValue|checked|required|disabled|min|max|step|inputMode|maxLength|ref|tabIndex|showCloseButton)$/.test(node.name.getText(tree))) bindings.push(node.getText(tree).replace(/\s+/g, ' '));
    if (ts.isCallExpression(node) && /^(useState|useEffect|useRef|fetch|JSON.stringify|resolveBankImportReceipt|loadBankImportHistory|loadBankImportReceipt|loadBankAllocationPreflight|loadBankReallocationPreflight|recoverBankAllocation|recoverBankReallocation|recordBankAllocation|recordBankReallocation|loadBankMappingProfiles|loadBankMappingProfile|mutateBankMappingProfile|buildBankCsvPreview|applyBankMappingProfile)$/.test(node.expression.getText(tree))) logic.push(node.getText(tree).replace(/\s+/g, ' '));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const hash = (values: string[]) => createHash('sha256').update(values.sort().join('\n')).digest('hex');
  return { bindings: hash(bindings), logic: hash(logic), count: bindings.length };
}

describe('bank presentation-only contracts against accepted main 17cd6f1', () => {
  it.each([
    ['bank-csv-workspace', '9f7266fabedc671403461f55ed72caf8957196b56158c9b31d610858542dac54', 'fc5a22bc798efe14aff59e4e0e99124bc309dd9706a0df222a242cf8fc8ebcd6', 85],
    ['bank-import-panel', 'd366327eb3c9b16ffbcb2db8f73c72fcb1006409707d754de024a2b06d93d603', 'f0195811c62f7dff465c38f3e16e9b525ee8e4855835d5c813faf0c315d5376f', 33],
    ['bank-mapping-profiles', '619ea9c797b59500beaab7673101e1102d0b946334ea3c87ee72666738c365cc', '400a943fa99d030b86bccc1fe31249d8888ca822cc14115b4fef64fdc0461f9b', 42],
    ['bank-allocation-row', '6a8297d41e3101a693af49462d258fbea343f3f8e6cbbd2a5a12f7531ff5a250', 'b0c347ebf2e82efc2759e0629180daad8dfc0b7e9a9e2d08e053868c94b14dd5', 71],
  ])('preserves every owned binding, focus ref, guard, request and hook in %s', (name, bindings, logic, count) => {
    expect(bankSourceContracts(readFileSync(`components/bank-csv/${name}.tsx`, 'utf8'))).toEqual({ bindings, logic, count });
  });
});
