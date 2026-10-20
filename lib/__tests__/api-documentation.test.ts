import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_DOCUMENTATION } from '@/lib/api-documentation';
import { GET } from '@/app/api/v1/docs/route';

type JsonObject = Record<string, unknown>;
function asObject(value: unknown): JsonObject { return value as JsonObject; }
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

const methods = ['get', 'post', 'put', 'delete', 'patch', 'options'];
const paths = API_DOCUMENTATION.paths;
const schemas = API_DOCUMENTATION.components.schemas;

describe('OpenAPI coverage regression #27', () => {
  it('covers all actual v1 route paths and supported methods without inventing writes', () => {
    const root = join(process.cwd(), 'app/api/v1');
    const routes = routeFiles(root);
    const expectedPaths = routes.map(file => '/' + relative(root, file).replace(/\/route\.ts$/, '')).sort();
    expect(Object.keys(paths).sort()).toEqual(expectedPaths);
    for (const file of routes) {
      const path = '/' + relative(root, file).replace(/\/route\.ts$/, '');
      const source = readFileSync(file, 'utf8');
      const exported = [...source.matchAll(/export (?:async function|const) (GET|POST|PUT|DELETE|PATCH|OPTIONS)\b/g)].map(match => match[1].toLowerCase());
      // These explicit handlers reject writes with 405, not supported operations.
      const supported = path === '/settings' ? ['get', 'options'] : exported;
      expect(Object.keys(paths[path]).filter(key => methods.includes(key)).sort(), path).toEqual(supported.sort());
    }
    expect(paths['/settings']).not.toHaveProperty('put');
    expect(paths['/reminders']).not.toHaveProperty('put');
    expect(paths['/invoices']).not.toHaveProperty('post');
    expect(paths['/invoices/upload']).not.toHaveProperty('get');
  });

  it('resolves every schema reference and supplies JSON/multipart write contracts', () => {
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const item = asObject(value);
      if ('$ref' in item) {
        expect(item.$ref).toMatch(/^#\/components\/schemas\//);
        expect(schemas).toHaveProperty(String(item.$ref).split('/').at(-1)!);
      }
      Object.values(item).forEach(visit);
    }
    visit(API_DOCUMENTATION);
    for (const [path, item] of Object.entries(paths)) {
      for (const method of ['post', 'put']) {
        if (item[method]) expect(asObject(item[method]).requestBody, `${method} ${path}`).toBeDefined();
      }
      for (const method of ['put', 'delete']) {
        if (!item[method]) continue;
        expect(asObject(item[method]).parameters).toContainEqual({ name: 'id', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } });
      }
    }
    const upload = asObject(paths['/invoices/upload'].post);
    expect(asObject(asObject(asObject(upload.requestBody).content)['multipart/form-data']).schema).toEqual(expect.objectContaining({ required: ['file'] }));
    expect(upload.responses).toHaveProperty('201');
    expect(upload.responses).toHaveProperty('422');
    expect(schemas.CashTransactionUpdate).toMatchObject({ additionalProperties: false });
    expect(Object.keys(asObject(schemas.CashTransactionUpdate.properties))).toEqual(['description', 'category', 'receiptNumber', 'notes', 'taxRelevant']);
    expect(asObject(schemas.IncomeInput).required).toContain('date');
    expect(asObject(schemas.Invoice.properties).issuanceState).toMatchObject({ enum: ['UNISSUED', 'ISSUED', 'UNKNOWN'] });
    expect(asObject(paths['/reminders'].get).responses).toHaveProperty('200');
  });

  it('serves the complete public contract without requiring an API key', async () => {
    const result = await GET();
    expect(result.status).toBe(200);
    expect(result.headers.get('access-control-allow-origin')).toBe('*');
    expect(await result.json()).toEqual(API_DOCUMENTATION);
    expect(asObject(paths['/docs'].get).security).toEqual([]);
  });

  it('uses operation-aware HTML tab and example labels for read-only and upload endpoints', () => {
    const source = readFileSync(join(process.cwd(), 'app/settings/api-keys/docs/page.tsx'), 'utf8');
    expect(source).toContain('"Ändern" : "Schreibzugriff"');
    expect(source).toContain('"POST-Anfrage (Datei-Upload):"');
    expect(source).toContain('"Nur lesbarer Endpunkt:"');
    expect(source).toContain('POST, PUT und DELETE sind nicht verfügbar.');
  });
});
