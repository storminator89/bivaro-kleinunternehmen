import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { inTransaction } from '@/lib/db-transaction';
import { defaultNumberingPolicy, DOCUMENT_TYPES, DocumentNumberingError, isDocumentType, MAX_NUMBERING_REVISIONS, validateNumberingFormat } from '@/lib/document-numbering-policy';
import { loadNumberingPolicies, previewDocumentNumber, previewNumberingChange } from '@/lib/invoice-numbers';

export async function GET() {
  try {
    const userId = await requireUserId();
    const result = await inTransaction(async tx => {
      const year = new Date().getFullYear();
      const policies = await loadNumberingPolicies(tx, userId);
      const rows = await Promise.all(DOCUMENT_TYPES.map(async type => {
        const policy = policies.filter(row => row.type === type).at(-1) ?? defaultNumberingPolicy(type, year);
        try { const next = await previewDocumentNumber(tx, userId, type, year); return { ...policy, effectiveYear: year, startSequence: next.value, nextNumber: next.number, error: null }; }
        catch (error) { if (!(error instanceof DocumentNumberingError)) throw error; return { ...policy, effectiveYear: year, nextNumber: null, error: error.message }; }
      }));
      return { version: 1, year, maxRevisions: MAX_NUMBERING_REVISIONS, rows };
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    return NextResponse.json({ error: 'Nummernformate konnten nicht geladen werden.' }, { status: 500 });
  }
}
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    let input: Record<string, unknown>;
    try { const value: unknown = await request.json(); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); input = value as Record<string, unknown>; }
    catch { return NextResponse.json({ error: 'Ein gültiges JSON-Objekt ist erforderlich.' }, { status: 400 }); }
    if (input.version !== 1 || !isDocumentType(input.type) || typeof input.expectedRevision !== 'number' || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= MAX_NUMBERING_REVISIONS || typeof input.action !== 'string' || !['preview', 'save'].includes(input.action)) throw new DocumentNumberingError('Ungültige Version, Dokumentart oder Revision.', 400);
    if (input.action === 'save' && (input.confirmed !== true || typeof input.expectedNumber !== 'string')) throw new DocumentNumberingError('Bitte die geprüfte Vorschau ausdrücklich bestätigen.', 400);
    const format = validateNumberingFormat(input);
    if (format.effectiveYear !== new Date().getFullYear()) throw new DocumentNumberingError('Das Jahr hat gewechselt. Bitte Einstellungen neu laden.', 409, 'NUMBERING_STALE');
    const policy = { ...format, type: input.type, revision: input.expectedRevision + 1 };
    const result = await inTransaction(async tx => {
      const preview = await previewNumberingChange(tx, userId, policy);
      if (input.action === 'preview') return { ...preview, saved: false, revision: input.expectedRevision };
      if (preview.nextNumber !== input.expectedNumber) throw new DocumentNumberingError('Die geprüfte Nummer hat sich inzwischen geändert. Bitte erneut prüfen.', 409, 'NUMBERING_STALE');
      await tx.documentNumberingPolicy.create({ data: { userId, ...policy } });
      await tx.auditLog.create({ data: { userId, action: 'SETTINGS_CHANGED', entityType: 'DocumentNumberingPolicy', entityId: `${policy.type}:${policy.revision}`, entityName: 'Nummernformat', metadata: JSON.stringify({ operation: 'settings.document-numbering.change', type: policy.type, revision: policy.revision, formatVersion: 1 }) } });
      return { ...preview, saved: true, revision: policy.revision };
    });
    return NextResponse.json({ version: 1, ...result }, { status: result.saved ? 201 : 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof DocumentNumberingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ error: 'Eine neuere Einstellung liegt vor. Bitte neu laden.', code: 'NUMBERING_STALE' }, { status: 409 });
    return NextResponse.json({ error: 'Speicherung nicht bestätigt. Bitte vor erneutem Speichern den Stand neu laden.' }, { status: 500 });
  }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: 4096 });
