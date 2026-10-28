import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync('app/customers/articles/page.tsx', 'utf8');
const css = readFileSync('app/customers/articles/articles-workspace.module.css', 'utf8');
function contracts(text: string) {
  const tree = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings: string[] = [], copy: string[] = [], logic: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) !== 'className') bindings.push(node.getText(tree).replace(/\s+/g, ' '));
    if (ts.isJsxText(node) && node.getText(tree).trim()) copy.push(node.getText(tree).trim().replace(/\s+/g, ' '));
    if (ts.isCallExpression(node) && ['useState', 'useEffect', 'formatArticlePrice', 'rows.filter'].includes(node.expression.getText(tree))) logic.push(node.getText(tree).replace(/\s+/g, ' '));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const hash = (values: string[]) => createHash('sha256').update(values.sort().join('\n')).digest('hex');
  return { bindings: hash(bindings), copy: hash(copy), logic: hash(logic) };
}
describe('article catalog presentation contracts', () => {
  it('preserves main56c37c0 bindings, copy, loading/filter and exact price logic', () => {
    expect(contracts(source)).toEqual({"bindings":"03b3a71fce89202389c702bffbd93650355a82951ff80fc58f3b0def97768dea","copy":"1631ed81090d6a1f19efe4fe7ed85f6b020647b074f922d043071730f94a208a","logic":"b1260f4fc6ec50e3bba1398a78ad9cba4e2f51b1f2bce91119b6d2a06926ea56"});
  });
  it('keeps accessible targets and readable long content', () => {
    expect(css).toContain('min-height: 2.75rem');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('overflow-wrap: anywhere');
  });
});
