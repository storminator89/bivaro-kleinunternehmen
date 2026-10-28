import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync('components/dashboard/tabs/invoices-tab.tsx', 'utf8');
const css = readFileSync('components/dashboard/tabs/invoice-workspace.module.css', 'utf8');
const details = readFileSync('components/dashboard/modals/invoice-details-modal.tsx', 'utf8');
const editor = readFileSync('components/dashboard/create-invoice-modal.tsx', 'utf8');
const tree = ts.createSourceFile('invoices-tab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fingerprint = (text: string) => createHash('sha256').update(text.replace(/\s+/g, ' ')).digest('hex');

// Baseline: dafbcea. These checks deliberately freeze existing contracts, not
// class names or visual markup. Financial eligibility stays frozen; the reviewed
// action relocation below is inventoried explicitly rather than refreshing hashes.
const frozenDeclarations: Record<string, string> = {
  canDeleteDraft: '4511c8e2e10c150a46281e57642ebc4b88df6ea2c4af0315dff96a6c7511a710',
  availableInvoiceStatuses: 'b17f7bc3b421186a973d6a02ddd72d96a570aa5a3e5a6ea5f80b6752849f06f0',
  InvoiceBalance: 'c57da60ec1a9b68319d89ec93c35e51df1a491fcb9a6a5add8ec8f62cbe6602f',
  InvoicesTabProps: '76455f1bb4c463486587a054e12a54223bc285f7024a030ba2922356d8c15f2c',
  paidCount: '4ffe8b4ee3988e2cea90367612013423a7acb50a09a1eb619a9fc98c933dacb0',
  openCount: 'd4a12d8858a98a2f3be3ac8fbda2cf48dd3a4844511dc98e45617aa41da3f8a5',
};
const declarations: Record<string, string> = {};
const bindings: string[] = [];
const filteredListNoticeBindings: string[] = [];
const contractAttribute = /^(id|name|type|href|accept|disabled|value|on[A-Z]\w*|data-\w[\w-]*|aria-sort|aria-busy|aria-describedby|availableStatuses|paymentReturnId|paymentState|returnFocusRef|documentType|documentId)$/;
function inspect(node: ts.Node) {
  if ((ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isVariableDeclaration(node)) && node.name) {
    const name = node.name.getText(tree);
    if (name in frozenDeclarations) declarations[name] = fingerprint(node.getText(tree));
  }
  if (ts.isJsxAttribute(node) && contractAttribute.test(node.name.getText(tree))) {
    const element = node.parent.parent;
    const decorativeIconName = node.name.getText(tree) === 'name'
      && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))
      && element.tagName.getText(tree) === 'DashboardIcon';
    // Inventory only these two reviewed additions separately; every other
    // callback/field still participates in the unchanged 87-binding baseline.
    const filteredListNoticeBinding = ts.isJsxSelfClosingElement(element)
      && element.tagName.getText(tree) === 'RecordListSearchNotice'
      && ['type', 'onClear'].includes(node.name.getText(tree));
    if (!decorativeIconName) {
      const binding = node.getText(tree).replace(/\s+/g, ' ');
      (filteredListNoticeBinding ? filteredListNoticeBindings : bindings).push(binding);
    }
  }
  ts.forEachChild(node, inspect);
}
inspect(tree);

describe('invoice workspace presentation boundaries', () => {
  it('keeps all financial presentation, eligibility and count declarations unchanged', () => {
    expect(declarations).toEqual(frozenDeclarations);
  });

  it('preserves the baseline bindings except for the explicitly reviewed action relocation', () => {
    // Invoice identity now owns Details, the eligible payment action is a visible
    // button, SENT moves out of the status badge, and quick PDF is outside More.
    // Normalize only these exact deltas back to the unchanged 87-binding baseline.
    const added = [
      'data-invoice-primary-action',
      'data-invoice-primary-action',
      'data-invoice-payment-return={invoice.id}',
      "onClick={() => onStatusChange(invoice.id, 'PAID')}",
      "onSelect={() => onStatusChange(invoice.id, 'SENT')}",
      'type="button"',
      'onClick={() => onViewReceipt(`/api/invoices/download?id=${invoice.id}`)}',
    ];
    const removed = [
      'onSelect={() => onViewReceipt(`/api/invoices/download?id=${invoice.id}`)}',
      'disabled={invoice.hasPdfFile === false}',
      'availableStatuses={availableInvoiceStatuses(invoice)}',
      'onStatusChange={(newStatus) => onStatusChange(invoice.id, newStatus)}',
      'availableStatuses={availableInvoiceStatuses(invoice)}',
      'onStatusChange={(newStatus) => onStatusChange(invoice.id, newStatus)}',
      'data-invoice-return={invoice.id}',
      'onClick={() => onOpenDetails(invoice)}',
    ];
    const normalized = [...bindings];
    for (const binding of added) {
      const index = normalized.indexOf(binding);
      expect(index, `reviewed added binding: ${binding}`).toBeGreaterThanOrEqual(0);
      normalized.splice(index, 1);
    }
    normalized.push(...removed);
    expect(bindings).toHaveLength(86);
    expect(normalized).toHaveLength(87);
    expect(fingerprint(normalized.sort().join('\n'))).toBe('5f0f370561baedeb0d402a70d568f654968d75d1bdb5cd53020a1a8f8557d349');
  });

  it('exposes the same eligible next actions without turning the status label into a menu', () => {
    const primary = source.slice(source.indexOf('const renderInvoicePrimaryAction'), source.indexOf('const renderInvoiceActions'));
    expect(primary).toContain('if (invoice.serviceDraftEditable) return (');
    expect(primary).toContain('href={`/dashboard/invoices/new?draftId=${invoice.id}`}');
    expect(primary).toContain("if (availableInvoiceStatuses(invoice).includes('PAID')) return (");
    expect(primary).toContain("onClick={() => onStatusChange(invoice.id, 'PAID')}");
    expect(primary).toContain('data-invoice-payment-return={invoice.id}');
    expect(primary).not.toMatch(/fetch\(|setEmailInvoice|onDelete|onCancel/);
    expect(source.match(/renderInvoicePrimaryAction\(invoice\)/g)).toHaveLength(2);
    expect(source).toContain("availableInvoiceStatuses(invoice).includes('SENT') && (");
    expect(source).toContain("onSelect={() => onStatusChange(invoice.id, 'SENT')}");
    const badges = source.match(/<StatusBadge\b[^>]*\/>/g) ?? [];
    expect(badges).toHaveLength(2);
    for (const badge of badges) expect(badge).not.toMatch(/onStatusChange|availableStatuses/);
  });

  it('keeps quick PDF, keyboard Details, evidence, and destructive-action protections reachable', () => {
    expect(source.match(/aria-label=\{`Details zu Rechnung \$\{invoice.invoiceNumber \|\| invoice.id\}`\}/g)).toHaveLength(2);
    expect(source.match(/invoice.hasPdfFile !== false && \(/g)).toHaveLength(2);
    expect(source.match(/onClick=\{\(\) => onViewReceipt\(`\/api\/invoices\/download\?id=\$\{invoice.id\}`\)\}/g)).toHaveLength(2);
    for (const label of ['Versand', 'Dateien', 'Nachweise', 'Korrekturen']) expect(source).toContain(`<DropdownMenuLabel>${label}</DropdownMenuLabel>`);
    expect(source).toContain("(!invoice.serviceDraftEditable && invoice.status !== 'CANCELLED' && invoice.type !== 'CREDIT_NOTE') && (");
    expect(source).toContain('disabled={isDeleting || !canDeleteDraft(invoice)}');
    expect(source).toContain('Nur nachweislich unausgestellte Entwürfe ohne Zahlung sind löschbar.');
    expect(source).toContain("invoice.type !== 'CREDIT_NOTE' && <DropdownMenuItem onSelect={() => onStatusChange(invoice.id, 'PAYMENT_HISTORY')}");
    expect(source).toContain('href={`/history?invoiceId=${invoice.id}`}');
  });

  it('prioritizes usable invoice files without hiding the XML-only viewer', () => {
    expect(details).toContain('invoice.hasPdfFile !== false && <>');
    expect(details).toContain('invoice.hasPdfFile === false && invoice.hasEInvoiceXml && (');
    for (const label of ['PDF öffnen', 'PDF herunterladen', 'E-Rechnung ansehen', 'XML herunterladen', 'Weitere Dateiformate']) expect(details).toContain(label);
    for (const route of ['/api/invoices/download?id=${invoice.id}', '/api/invoices/download?id=${invoice.id}&download=true', '/api/invoices/viewer?id=${invoice.id}', '/api/invoices/download?id=${invoice.id}&format=xml&download=true']) expect(details).toContain(route);
    expect(details).toContain('Noch keine Rechnungsdatei vorhanden.');
    expect(details).toContain('Zahlungsstand muss anhand der historischen Nachweise geprüft werden.');
    expect(details).toContain('Erstattungsstand prüfen; aus dem Rechnungsstorno folgt keine Auszahlung.');
  });

  it('clarifies final file creation while freezing issue, upload, draft and busy-state handlers', () => {
    const expected: Record<string, string> = {
      uploadGeneratedInvoice: '371356dc9abdae19a8c144a5708a6de78180f43c4489b06164702c5da7652aaa',
      saveServiceDraft: '333a1c5f7d11f73b58f7c3c8d27380a4db754d512c4d40c6877d7d77a2f4f5f9',
      createInvoiceFile: 'd3cc7ae47f0c7964e63e6cc09f2df7b97997d3bdc442cc2b07dc44d1f6a8bbda',
      requestClose: '3f3768c32a9f501ca6fec66d9431794d47d91f8812db2f64d3c5ae0045b60a27',
      blockBusyEditorInteraction: '15da87eedef88abf81cc5d0bcfe180b7eac729abf737d6d16371968fabf3bd91',
    };
    const found: Record<string, string> = {};
    const editorTree = ts.createSourceFile('create-invoice-modal.tsx', editor, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const inspectEditor = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name && node.name.getText(editorTree) in expected) found[node.name.getText(editorTree)] = fingerprint(node.getText(editorTree));
      ts.forEachChild(node, inspectEditor);
    };
    inspectEditor(editorTree);
    expect(found).toEqual(expected);
    expect(editor).toContain('Beim Erstellen werden Rechnungsnummer und Angaben festgeschrieben.');
    expect(editor).toContain('nicht versendet. Es wird keine Zahlung erfasst.');
    expect(editor).toContain('aria-describedby={!taxReady ? "invoice-create-effect invoice-tax-blocker" : "invoice-create-effect"}');
    expect(editor).toContain('PDF mit eingebetteter XML (ZUGFeRD)');
    expect(editor).toContain('Nur XML (XRechnung)');
  });

  it('pins the two additive filtered-list notice bindings without changing the baseline fingerprint', () => {
    expect(filteredListNoticeBindings).toEqual([
      'type="outbound"',
      "onClear={clear => { setFilters({ ...filters, searchTerm: '', paidStatus: 'all', dateRange: 'all' }); clear(); }}",
    ]);
  });

  it('makes search first in keyboard order and invoice identity first in the desktop ledger', () => {
    expect(source.indexOf('id="invoice-search"')).toBeLessThan(source.indexOf('<fieldset'));
    expect(source.indexOf("aria-sort={filters.sortBy === 'invoiceNumber'")).toBeLessThan(source.indexOf("aria-sort={filters.sortBy === 'date'"));
    expect(source.match(/paymentReturnId=\{invoice.id\}/g)).toHaveLength(2);
  });

  it('retains visible focus, motion fallback, readable content and 44px controls', () => {
    expect(css).toContain('min-height: 2.75rem');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('outline: 2px solid var(--color-focus)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toMatch(/100vw|overflow-x:\s*hidden|overflow:\s*clip/i);
    expect(css).toContain('.workspace .desktopRecord :global(td button[aria-label^="Details zu Rechnung"]) { min-height: 2.75rem; }');
  });
});
