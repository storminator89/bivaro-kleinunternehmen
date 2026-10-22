import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Evaluate only the exact trusted diagnostic preamble, not any PDF.js, canvas,
// filesystem, process-launcher or renderer operation. No native acceptance claim.
const source = readFileSync('scripts/ai-pdf/render.mjs', 'utf8');
const start = source.indexOf('let diagnostic = false;'), end = source.indexOf('function geometry(');
if (start < 0 || end <= start) throw new Error('Diagnostic preamble is missing');
const preamble = source.slice(start, end);
function capture() {
  const writes: string[] = [], output: Record<string, (...args: unknown[]) => void> = {};
  const context = createContext({ console: output, writeSync: (fd: number, text: string) => {
    expect(fd).toBe(1); writes.push(text); return text.length;
  } }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(preamble, context, { timeout: 50 });
  return { writes, output, assertFatal: () => expect(() => runInContext('assertClean()', context, { timeout: 50 })).toThrow('Renderer reported recovery or unsupported content') };
}
const examples = [
  ['info', 'Info: Inconsistent font file Type/SubType, expected: Type1/undefined but found: TrueType/undefined.', 'font-type1-truetype'],
  ['info', 'Info: Inconsistent font file Type/SubType, expected: PRIVATE but found: PRIVATE.', 'font-type-mismatch'],
  ['warn', 'Warning: UnknownErrorException: Unable to load font data at: /private/font.ttf', 'asset-font'],
  ['warn', 'Warning: Error: Unable to load CMap data at: /private/cmap', 'asset-cmap'],
  ['warn', 'Warning: Unable to load wasm data at: /private/wasm', 'asset-wasm'],
  ['warn', 'Warning: TT: CALL non-existent function PRIVATE', 'font-repair'],
  ['info', 'Info: cff data is shifted', 'font-repair'],
  ['info', 'Info: Malformed dictionary: PRIVATE DOCUMENT TEXT', 'parser-recovery'],
  ['warn', 'Warning: getOperatorList - ignoring XObject: PRIVATE DOCUMENT TEXT', 'operator-recovery'],
  ['info', 'Info: Unknown graphic state operator PRIVATE', 'graphics-unsupported'],
  ['warn', 'Warning: Image exceeded maximum allowed size PRIVATE', 'image-decoder'],
  ['warn', 'Warning: Setting up fake worker.', 'worker-setup'],
  ['log', 'PRIVATE DOCUMENT TEXT /private/provider-key', 'other'],
] as const;

describe('fixed PDF diagnostic protocol (pure source-level checks)', () => {
  it.each(examples)('classifies %s diagnostic as %s without accepting it', (method, text, code) => {
    const item = capture(); item.output[method](text);
    expect(item.writes).toEqual([`BIVARO_AI_PDF_DIAGNOSTIC ${code}\n`]);
    expect(item.writes.join('')).not.toMatch(/PRIVATE|private|provider-key|font\.ttf/);
    item.assertFatal();
  });
  it.each(['log', 'info', 'warn', 'error', 'debug'])('keeps every %s call fatal, even without a string', method => {
    const item = capture(); item.output[method]();
    expect(item.writes).toEqual(['BIVARO_AI_PDF_DIAGNOSTIC other\n']); item.assertFatal();
  });
  it.each(['log', 'warn', 'error', 'debug'])('does not treat a shape on the wrong %s method as the exact info diagnostic', method => {
    const item = capture(); item.output[method](examples[0][1]);
    expect(item.writes).toEqual(['BIVARO_AI_PDF_DIAGNOSTIC other\n']); item.assertFatal();
  });
  it.each([
    ['Info: Inconsistent font file Type/SubType, expected: Type1/undefined but found: TrueType/undefined. PRIVATE'],
    ['Info: Inconsistent font file Type/SubType, expected: Type1/undefined but found: TrueType/undefined.\nPRIVATE'],
    ['Info: Inconsistent font file Type/SubType, expected: Type1/undefined but found: TrueType/undefined.\x00PRIVATE'],
    ['PRIVATE'.repeat(1000)],
    [examples[0][1], 'PRIVATE SECOND ARGUMENT'],
  ])('cannot promote unknown, altered, multiline, oversized or multi-argument data into the exact shape', (...args) => {
    const item = capture(); item.output.info(...args);
    expect(item.writes).not.toContain('BIVARO_AI_PDF_DIAGNOSTIC font-type1-truetype\n'); item.assertFatal();
  });
  it('does not stringify objects or run user-defined getters/coercion', () => {
    const item = capture();
    const object = { toString() { throw new Error('PRIVATE COERCION'); }, get message() { throw new Error('PRIVATE GETTER'); } };
    expect(() => item.output.warn(object)).not.toThrow();
    expect(item.writes).toEqual(['BIVARO_AI_PDF_DIAGNOSTIC other\n']); item.assertFatal();
  });
  it('deduplicates all finite codes and bounds protocol bytes regardless of repeated input', () => {
    const item = capture();
    for (let repeat = 0; repeat < 100; repeat++) for (const [method, text] of examples) item.output[method](text);
    expect(item.writes).toHaveLength(12);
    expect(new Set(item.writes).size).toBe(12);
    expect(item.writes.join('').length).toBeLessThan(1024);
    expect(item.writes.join('')).not.toMatch(/PRIVATE|private|provider-key/); item.assertFatal();
  });
  it('retains full info diagnostics and strict PDF parsing without a success exception', () => {
    expect(source).toContain('stopAtErrors: true, verbosity: VerbosityLevel.INFOS');
    expect(source).toContain("const reason = diagnostic ? 'pdf-diagnostic'");
    expect(source).toContain('assertClean();');
  });
});
