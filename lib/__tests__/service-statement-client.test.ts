import { describe, expect, it } from 'vitest';
import { readStatementResponse, STATEMENT_DOWNLOAD_ERROR, StatementRequestError } from '@/lib/service-statement-client';

describe('understandable statement response failures', () => {
  it.each(['<html>Bad Gateway</html>', '{', ''])('handles non-JSON error body %j without exposing parser internals', async body => {
    await expect(readStatementResponse(new Response(body, { status: 503 }))).rejects.toThrow(STATEMENT_DOWNLOAD_ERROR);
  });
  it('preserves bounded server messages and explains expired authentication', async () => {
    await expect(readStatementResponse(Response.json({ error: 'Auswahl bitte neu laden.' }, { status: 409 }))).rejects.toThrow('Auswahl bitte neu laden.');
    await expect(readStatementResponse(Response.json({ error: 'x'.repeat(501) }, { status: 500 }))).rejects.toThrow(STATEMENT_DOWNLOAD_ERROR);
    await expect(readStatementResponse(Response.json({ error: 'Unauthorized' }, { status: 401 }))).rejects.toThrow('Bitte anmelden');
  });
  it.each([null, {}, { snapshot: { rows: [] }, pdfBase64: 'test', filename: 'test.pdf' }])('rejects incomplete successful result %j safely', async data => {
    await expect(readStatementResponse(Response.json(data))).rejects.toBeInstanceOf(StatementRequestError);
  });
  it('returns the same snapshot and file supplied by the server', async () => {
    const result = { snapshot: { rows: [{ id: 1 }] }, pdfBase64: 'JVBERi0=', filename: 'test.pdf' };
    expect(await readStatementResponse(Response.json(result))).toEqual(result);
  });
});
