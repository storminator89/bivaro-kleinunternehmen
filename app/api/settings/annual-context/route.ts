import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { ANNUAL_CONTEXT_VERSION, MAX_ANNUAL_CONTEXT_REVISIONS, readAnnualContextRevision, validateAnnualContext } from '@/lib/annual-business-context';

export async function GET() {
  try {
    const userId = await requireUserId();
    const rows = await prisma.annualBusinessContextRevision.findMany({ where: { userId }, orderBy: { revision: 'asc' } });
    return NextResponse.json({ version: ANNUAL_CONTEXT_VERSION, revision: rows.at(-1)?.revision ?? 0, history: rows.map(readAnnualContextRevision) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    return NextResponse.json({ error: 'Jahreskontext konnte nicht geladen werden.' }, { status: 500 });
  }
}
class RevisionConflict extends Error {}
async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    let body: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      body = value as Record<string, unknown>;
    } catch { return NextResponse.json({ error: 'Ein gültiges JSON-Objekt ist erforderlich.' }, { status: 400 }); }
    const validation = validateAnnualContext(body);
    if (!validation.ok) return NextResponse.json({ error: 'Bitte den Jahreskontext prüfen.', fieldErrors: validation.fieldErrors }, { status: 400 });
    if (body.version !== ANNUAL_CONTEXT_VERSION || typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.declaration !== true) {
      return NextResponse.json({ error: 'Version, bekannte Revision und ausdrückliche Erklärung sind erforderlich.' }, { status: 400 });
    }
    if (body.expectedRevision >= MAX_ANNUAL_CONTEXT_REVISIONS) return NextResponse.json({ error: 'Die maximale Zahl an Kontextrevisionen ist erreicht.' }, { status: 422 });
    const expectedRevision = body.expectedRevision;
    const row = await prisma.$transaction(async tx => {
      const latest = await tx.annualBusinessContextRevision.findFirst({ where: { userId }, orderBy: { revision: 'desc' }, select: { revision: true } });
      if ((latest?.revision ?? 0) !== expectedRevision) throw new RevisionConflict();
      const revision = await tx.annualBusinessContextRevision.create({ data: { userId, revision: expectedRevision + 1, ...validation.data } });
      // Atomic field-name-only audit; never duplicate source note or amounts.
      await tx.auditLog.create({ data: { userId, action: 'SETTINGS_CHANGED', entityType: 'AnnualBusinessContextRevision', entityId: String(revision.revision), entityName: 'Optionaler Jahreskontext', metadata: JSON.stringify({ operation: 'settings.annual-context.declare', version: 1, revision: revision.revision, contextYear: revision.contextYear, provenance: 'USER_DECLARED' }) } });
      return revision;
    });
    return NextResponse.json({ version: ANNUAL_CONTEXT_VERSION, revision: row.revision, saved: readAnnualContextRevision(row) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof RevisionConflict || (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034', 'P1008'].includes(error.code))) return NextResponse.json({ error: 'Eine neuere Revision liegt vor. Ihre Eingaben wurden nicht gespeichert. Laden Sie den Stand und prüfen Sie Ihre Korrektur erneut.' }, { status: 409 });
    return NextResponse.json({ error: 'Jahreskontext wurde nicht gespeichert. Ihre Eingaben bleiben erhalten.' }, { status: 500 });
  }
}
export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
