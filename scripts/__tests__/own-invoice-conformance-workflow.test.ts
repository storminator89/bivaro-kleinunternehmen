import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/own-invoice-pdfa.yml', import.meta.url), 'utf8');
// Normalizing only the orchestration ceiling must reproduce the accepted
// workflow. Refresh this pin only after reviewing another workflow change.
const acceptedFifteenMinuteWorkflowSha256 = 'baeed2e9869d536fcc8b668aaa502d579d56609b12825f16283ff6490048fb49';

describe('own-invoice native conformance orchestration budget', () => {
  it('changes only the whole-job ceiling, not commands, resource overrides, trust, assertions or retention', () => {
    expect(workflow.match(/^    timeout-minutes: 30$/gm)).toHaveLength(1);
    const normalized = workflow.replace('    timeout-minutes: 30\n', '    timeout-minutes: 15\n');
    expect(createHash('sha256').update(normalized).digest('hex')).toBe(acceptedFifteenMinuteWorkflowSha256);
  });

  it('still requires both native architectures, every real case and every exact final page', () => {
    expect(workflow).toContain('architecture: x64');
    expect(workflow).toContain('architecture: arm64');
    expect(workflow).toContain("BIVARO_RUN_OWN_INVOICE_PDFA_ACCEPTANCE: '1'");
    expect(workflow).toContain('run: npm test -- lib/__tests__/own-invoice-pdfa-acceptance.test.ts');
    expect(workflow).toContain('m.cases.length!==10 || !m.malformedLogoPassed || !m.overlongIdentifierPassed || !m.overlongUnitPassed');
    expect(workflow).toContain('case "$pdf" in *-preview.pdf) continue ;; esac');
    expect(workflow).toContain('pdftoppm -scale-to 2000 -png "$pdf"');
    expect(workflow).toContain('retention-days: 1');
  });
});
