import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { buildDocumentEmailDraft, normalizeEmailDraftRequest } from '@/lib/email';

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = normalizeEmailDraftRequest(await request.json());
    const draft = await buildDocumentEmailDraft(userId, payload);

    return NextResponse.json(draft);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }

    const message = error instanceof Error ? error.message : 'E-Mail-Vorschau konnte nicht erstellt werden';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
