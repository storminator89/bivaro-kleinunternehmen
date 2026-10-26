import { describe, expect, it } from 'vitest';
import { classifyPublicReadOnlyRequest, publicAuthDiagnosticMetadata } from '../../e2e/helpers/public-read-only';

const origin = 'https://synthetic.example.test';

describe('public acceptance read-only request classification', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('permits the read method %s', method => {
    expect(classifyPublicReadOnlyRequest(method, `${origin}/api/auth/session`, origin)).toBe('read');
  });

  it('separately classifies only the exact same-origin auth diagnostic POST', () => {
    expect(classifyPublicReadOnlyRequest('POST', `${origin}/api/auth/_log`, origin)).toBe('auth-diagnostic');
  });

  it.each([
    ['POST', '/api/auth/_log?code=CLIENT_FETCH_ERROR'],
    ['POST', '/api/auth/_log/'],
    ['PUT', '/api/auth/_log'],
    ['PATCH', '/api/auth/_log'],
    ['DELETE', '/api/auth/_log'],
    ['POST', '/api/auth/session'],
    ['POST', '/api/auth/register'],
    ['POST', '/api/settings'],
    ['POST', '/api/invoices'],
    ['POST', '/help'],
  ])('blocks the non-read variant %s %s', (method, path) => {
    expect(classifyPublicReadOnlyRequest(method, `${origin}${path}`, origin)).toBe('forbidden');
  });

  it('does not exempt an identically named endpoint on another origin', () => {
    expect(classifyPublicReadOnlyRequest('POST', 'https://other.example.test/api/auth/_log', origin)).toBe('forbidden');
  });

  it('retains only bounded diagnostic level/code, never payload metadata', () => {
    expect(publicAuthDiagnosticMetadata('level=error&code=CLIENT_FETCH_ERROR&message=private&stack=private&url=private&session=private')).toEqual({
      level: 'error', code: 'CLIENT_FETCH_ERROR',
    });
  });

  it.each([null, '', 'level=private&code=private@example.test', `level=error&code=${'A'.repeat(81)}`])('marks missing or unrecognized diagnostics without retaining their text', body => {
    const metadata = publicAuthDiagnosticMetadata(body);
    expect(metadata.code).toBe('UNRECOGNIZED');
    expect(['error', 'unrecognized']).toContain(metadata.level);
  });
});
