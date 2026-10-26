const expression = value => '$' + '{{ ' + value + ' }}';

export const OLD_FUNCTIONAL_HEADER = '      - name: Run the complete functional suite\n';
export const NEW_FUNCTIONAL_HEADER = OLD_FUNCTIONAL_HEADER + '        id: functional-suite\n';
export const OLD_FUNCTIONAL_ENV = '        env:\n          BIVARO_EINVOICE_ASSETS:';
export const NEW_FUNCTIONAL_ENV = '        env:\n          BIVARO_BROWSER_RECEIPT_HEAD: ' +
  expression('github.event.pull_request.head.sha || github.sha') + '\n          BIVARO_EINVOICE_ASSETS:';
export const OLD_REPORTER = '          --reporter=github\n';
export const NEW_REPORTER = '          --reporter=github,./scripts/early-browser-receipt.mjs\n';
export const EARLY_RECEIPT_STEPS = [
  '      # Additive early receipt only; every existing functional/evidence gate stays below.',
  '      - name: Finalize bounded early functional receipt',
  '        id: early-receipt',
  '        if: ' + expression('always()'),
  '        continue-on-error: true',
  '        timeout-minutes: 1',
  '        env:',
  '          BIVARO_BROWSER_RECEIPT_HEAD: ' + expression('github.event.pull_request.head.sha || github.sha'),
  '          BIVARO_BROWSER_RECEIPT_DIRECTORY: ' + expression('steps.functional-suite.outputs.early_receipt_directory'),
  '          BIVARO_BROWSER_SUITE_OUTCOME: ' + expression('steps.functional-suite.outcome'),
  '        run: node scripts/finalize-browser-receipt.mjs',
  '',
  '      - name: Upload bounded early functional receipt',
  '        if: ' + expression("always() && steps.early-receipt.outputs.early_receipt_ready == 'true'"),
  '        continue-on-error: true',
  '        timeout-minutes: 1',
  '        uses: actions/upload-artifact@v4',
  '        with:',
  '          name: browser-early-functional-receipt',
  '          path: ' + expression('steps.early-receipt.outputs.early_receipt_directory') + '/receipt.json',
  '          retention-days: 1',
  '          if-no-files-found: warn',
  '          include-hidden-files: false',
  '          compression-level: 0',
  '',
  '',
].join('\n');

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Expected exactly one reviewed early-receipt delta');
  return source.replace(before, after);
}

export function addEarlyReceipt(source) {
  let result = replaceOnce(source, OLD_FUNCTIONAL_HEADER, NEW_FUNCTIONAL_HEADER);
  result = replaceOnce(result, OLD_FUNCTIONAL_ENV, NEW_FUNCTIONAL_ENV);
  result = replaceOnce(result, OLD_REPORTER, NEW_REPORTER);
  const next = '      - name: Require both real final-byte browser cases and render all their PDF pages\n';
  return replaceOnce(result, next, EARLY_RECEIPT_STEPS + next);
}

/** Only historical hash/length inputs use this strict inverse, never raw safety guards. */
export function withoutEarlyReceipt(source) {
  const additions = [NEW_FUNCTIONAL_HEADER, NEW_FUNCTIONAL_ENV, NEW_REPORTER, EARLY_RECEIPT_STEPS];
  if (!additions.some(value => source.includes(value))) return source;
  let result = replaceOnce(source, EARLY_RECEIPT_STEPS, '');
  result = replaceOnce(result, NEW_FUNCTIONAL_HEADER, OLD_FUNCTIONAL_HEADER);
  result = replaceOnce(result, NEW_FUNCTIONAL_ENV, OLD_FUNCTIONAL_ENV);
  return replaceOnce(result, NEW_REPORTER, OLD_REPORTER);
}
