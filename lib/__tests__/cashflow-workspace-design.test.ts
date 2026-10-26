import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source-only guard, baseline main 9229ed2. No network, browser or database.
// Sorted multisets allow presentation reordering, but preserve every non-class
// JSX attribute (including handlers, guards, routes, options) and visible copy.
// #54's reviewed delta is only the optional onManualRecord binding and the
// extraction of both income action groups into finalized-aware IncomeRowActions.
// Normalize those exact boundaries below; retain EVERY original baseline hash.
// The replacement's data/handlers/labels/disabled state and FINALIZED guard are
// independently asserted, not silently exempted from the contract.
// #169 adds only reviewed local submission-state UI around the same financial
// bindings. Normalize its exact attributes/optional props/conditional save copy
// below and assert each addition independently; do not replace baseline hashes.
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
// Frozen pre-#54 action attributes/copy from accepted 98a9da4. Presentation-only
// className attributes are intentionally absent, exactly as in the old walker.
// These reconstitute the two extracted groups for the original tab fingerprint;
// they are not executed or used as a replacement for testing the new actions.
const previousIncomeActions = ts.createSourceFile('previous-income-actions.tsx', `
<>
  <Button variant="outline" size="sm" onClick={() => onEdit(income)}>Bearbeiten</Button>
  <Button variant="outline" size="sm" onClick={() => onDuplicate(income)}>Duplizieren</Button>
  <Button variant="ghost" size="sm" disabled={isDeleting} onClick={() => onDelete(income.id)}>Löschen</Button>
  <TooltipProvider><div>
    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" aria-label={\`\${income.description} duplizieren\`} onClick={() => onDuplicate(income)}>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h6a2 2 0 002-2v-8a2 2 0 00-2-2h-6a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
    </Button></TooltipTrigger><TooltipContent><p>Duplizieren</p></TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" aria-label={\`\${income.description} bearbeiten\`} onClick={() => onEdit(income)}>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
    </Button></TooltipTrigger><TooltipContent><p>Bearbeiten</p></TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" aria-label={\`\${income.description} löschen\`} onClick={() => onDelete(income.id)} disabled={isDeleting}>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
    </Button></TooltipTrigger><TooltipContent><p>Löschen</p></TooltipContent></Tooltip>
  </div></TooltipProvider>
</>`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const css = readFileSync('components/dashboard/tabs/cashflow-workspace.module.css', 'utf8');
const digest = (s: string) => createHash('sha256').update(s.replace(/\s+/g, ' ')).digest('hex');
for (const kind of ['incomes', 'expenses'] as const) {
  const text = readFileSync(`components/dashboard/tabs/${kind}-tab.tsx`, 'utf8');
  const tree = ts.createSourceFile('tab.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const attrs: string[] = [], copy: string[] = [];
  const declarations: Record<string, string> = {};
  const lifecycleBindings: string[][] = [];
  const lifecycleProps: string[] = [];
  const submissionAttrs: string[] = [];
  const submissionProps: string[] = [];
  const submissionFeedback: string[][] = [];
  const submissionCopy: string[] = [];
  const submissionDeclarations: Record<string, string> = {};
  function inspect(n: ts.Node, source = tree) {
    if (source === tree && ts.isJsxSelfClosingElement(n) && n.tagName.getText(source) === 'ManualEntrySubmitFeedback') {
      submissionFeedback.push(n.attributes.properties.map(attribute => attribute.getText(source)).sort());
      return;
    }
    if (source === tree && ts.isJsxExpression(n)) {
      const label = kind === 'incomes' ? 'Einnahme' : 'Ausgabe';
      const exactCopy = `{entryPending ? '${label} wird gespeichert …' : '${label} speichern'}`;
      if (n.getText(source) === exactCopy) {
        submissionCopy.push(exactCopy);
        copy.push(`${label} speichern`);
        return;
      }
    }
    if (source === tree && ts.isJsxSelfClosingElement(n) && n.tagName.getText(source) === 'IncomeRowActions') {
      lifecycleBindings.push(n.attributes.properties.map(attribute => attribute.getText(source)).sort());
      return; // Only this exact reviewed extraction is normalized below.
    }
    if (ts.isJsxAttribute(n) && n.name.getText(source) !== 'className') {
      const element = n.parent.parent;
      if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
        if (source === tree) {
          const tag = element.tagName.getText(source);
          const attribute = n.getText(source);
          const has = (text: string) => element.attributes.properties.some(property => property.getText(source) === text);
          const reviewed =
            (tag === 'form' && attribute === 'aria-busy={entryPending}') ||
            (tag === 'fieldset' && ['disabled={entryLocked}', 'inert={entryLocked}'].includes(attribute)) ||
            (tag === 'Button' && has('type="submit"') && ['disabled={entryLocked}', 'aria-busy={entryPending}'].includes(attribute)) ||
            (tag === 'Button' && has('onClick={onOpenRecurringExpenses}') && attribute === 'disabled={entryLocked}') ||
            (tag === 'Input' && has('id="receipt"') && attribute === 'key={expenseReceiptInputKey}');
          if (reviewed) {
            submissionAttrs.push(`${tag}${has('onClick={onOpenRecurringExpenses}') ? '[recurring]' : ''}:${attribute}`);
            return;
          }
        }
        if (source === tree && element.tagName.getText(source) === 'ExpenseRowActions' && n.name.getText(source) === 'onManualRecord') {
          lifecycleBindings.push([n.getText(source)]);
          return; // Existing expense action/data bindings remain fingerprinted.
        }
        attrs.push(element.tagName.getText(source) + ':' + n.getText(source).replace(/\s+/g, ' '));
      }
    }
    if (ts.isJsxText(n) && n.getText(source).trim()) copy.push(n.getText(source).trim().replace(/\s+/g, ' '));
    if (source === tree && ts.isVariableDeclaration(n) && ['entryLocked', 'entryPending'].includes(n.name.getText(source))) {
      submissionDeclarations[n.name.getText(source)] = n.getText(source).replace(/\s+/g, ' ');
    }
    if ((ts.isFunctionDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isVariableDeclaration(n)) && n.name && ['IncomeInvoiceAttribution', 'IncomesTabProps', 'ExpensesTabProps', 'allCategories', 'sort', 'hasFilters'].includes(n.name.getText(source))) {
      let declaration = n.getText(source);
      if (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type) && ['IncomesTabProps', 'ExpensesTabProps'].includes(n.name.text)) {
        const extension = n.type.members.filter(member => member.name?.getText(source) === 'onManualRecord');
        lifecycleProps.push(...extension.map(member => member.getText(source)));
        submissionProps.push(...n.type.members.filter(member => ['submission', 'expenseReceiptInputKey'].includes(member.name?.getText(source) ?? '')).map(member => member.getText(source)));
        // Remove precisely the approved optional property, not arbitrary props.
        declaration = declaration.replace(/onManualRecord\?: ManualRecordOpener;\s*/u, '');
        declaration = declaration.replace(/submission\?: ManualEntrySubmitControls;\s*/u, '').replace(/expenseReceiptInputKey\?: number;\s*/u, '');
      }
      declarations[n.name.getText(source)] = digest(declaration);
    }
    ts.forEachChild(n, child => inspect(child, source));
  }
  inspect(tree);
  if (kind === 'incomes') inspect(previousIncomeActions, previousIncomeActions);
  describe(`${kind} presentation contract`, () => {
    it('preserves all non-presentation bindings and financial declarations', () => {
      expect({ bindings: digest(attrs.sort().join('\n')), count: attrs.length, copy: digest(copy.sort().join('\n')), declarations }).toEqual(baseline[kind]);
    });
    it('permits only the explicit approved lifecycle extension/action bindings', () => {
      expect(lifecycleProps).toEqual(['onManualRecord?: ManualRecordOpener;']);
      if (kind === 'incomes') {
        const originalHandlers = ['income={income}', 'onEdit={onEdit}', 'onDuplicate={onDuplicate}', 'onDelete={onDelete}', 'isDeleting={isDeleting}', 'onManualRecord={onManualRecord}'];
        expect(lifecycleBindings).toEqual([[...originalHandlers].sort(), [...originalHandlers, 'compact'].sort()]);
      } else {
        expect(lifecycleBindings).toEqual([['onManualRecord={onManualRecord}'], ['onManualRecord={onManualRecord}']]);
      }
    });
    it('permits only the reviewed local submit-state UI while retaining every original financial binding/hash', () => {
      const label = kind === 'incomes' ? 'Einnahme' : 'Ausgabe';
      expect(submissionProps.sort()).toEqual((kind === 'incomes' ? ['submission?: ManualEntrySubmitControls;']
        : ['expenseReceiptInputKey?: number;', 'submission?: ManualEntrySubmitControls;']).sort());
      expect(submissionDeclarations).toEqual({
        entryLocked: "entryLocked = Boolean(submission && submission.state.phase !== 'idle')",
        entryPending: "entryPending = submission?.state.phase === 'pending'",
      });
      const expectedAttrs = ['form:aria-busy={entryPending}', 'fieldset:disabled={entryLocked}', 'fieldset:inert={entryLocked}',
        'Button:disabled={entryLocked}', 'Button:aria-busy={entryPending}'];
      if (kind === 'expenses') expectedAttrs.push('Button[recurring]:disabled={entryLocked}', 'Input:key={expenseReceiptInputKey}');
      expect(submissionAttrs.sort()).toEqual(expectedAttrs.sort());
      expect(submissionFeedback).toEqual([['controls={submission}', `nextLabel="Weitere ${label} erfassen"`].sort()]);
      expect(submissionCopy).toEqual([`{entryPending ? '${label} wird gespeichert …' : '${label} speichern'}`]);
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
      expect(css).toContain('@media (max-width: 479px)');
      expect(css).toContain('.workspace .filters { grid-template-columns: minmax(0, 1fr); }');
    });
  });
}
it('makes receipt input keyboard reachable without changing native file binding', () => {
  expect(css).toContain('.fileInput { position: absolute;');
  expect(css).toContain('.attachment:focus-within');
  expect(css).not.toMatch(/\.fileInput[^}]*display:\s*none/);
});

it('preserves extracted income actions, data and copy under the explicit finalized guard', () => {
  const text = readFileSync('components/manual-financial-records/income-row-actions.tsx', 'utf8');
  const tree = ts.createSourceFile('income-row-actions.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const buttons: ts.JsxOpeningElement[] = [];
  const statuses: ts.JsxSelfClosingElement[] = [];
  function collect(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'Button') buttons.push(node);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'ManualRecordStatus') statuses.push(node);
    ts.forEachChild(node, collect);
  }
  collect(tree);
  const attribute = (node: ts.JsxOpeningElement, name: string) => node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(tree) === name)?.getText(tree);
  expect(buttons).toHaveLength(3);
  const expected = [
    ['onClick={() => onEdit(income)}', 'Bearbeiten', 'bearbeiten'],
    ['onClick={() => onDuplicate(income)}', 'Duplizieren', 'duplizieren'],
    ['onClick={() => onDelete(income.id)}', 'Löschen', 'löschen'],
  ];
  buttons.forEach((button, index) => {
    expect(attribute(button, 'onClick')).toBe(expected[index][0]);
    expect(attribute(button, 'aria-label')).toBe('aria-label={`' + '${income.description} ' + expected[index][2] + '`}');
    expect(attribute(button, 'disabled')).toBe(index === 2 ? 'disabled={isDeleting}' : undefined);
    const element = button.parent as ts.JsxElement;
    expect(element.children.filter(ts.isJsxText).map(child => child.getText(tree).trim()).join('')).toBe(expected[index][1]);
    let ancestor: ts.Node | undefined = element.parent;
    while (ancestor && !ts.isBinaryExpression(ancestor)) ancestor = ancestor.parent;
    expect(ancestor && ts.isBinaryExpression(ancestor) ? ancestor.operatorToken.kind : undefined).toBe(ts.SyntaxKind.AmpersandAmpersandToken);
    expect(ancestor && ts.isBinaryExpression(ancestor) ? ancestor.left.getText(tree) : undefined).toBe("income.manualRecordState !== 'FINALIZED'");
  });
  expect(statuses).toHaveLength(1);
  expect(statuses[0].attributes.properties.map(property => property.getText(tree)).sort()).toEqual([
    'kind="income"', 'id={income.id}', 'description={income.description}', 'state={income.manualRecordState}', 'onOpen={onManualRecord}',
  ].sort());
});
