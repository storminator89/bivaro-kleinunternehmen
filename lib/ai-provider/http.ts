import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorizedResponse, ForbiddenError, forbiddenResponse } from '@/lib/get-user-id';
import { AiProviderError } from './errors';
export function aiProviderErrorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof ForbiddenError) return forbiddenResponse();
  if (error instanceof AiProviderError) return NextResponse.json({ error: error.message, code: error.code, requestMayHaveBeenSent: error.requestMayHaveBeenSent }, { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 });
  // Deliberately no error object logging (SDK/network errors may echo credentials).
  return NextResponse.json({ error: 'KI-Einstellungen konnten nicht verarbeitet werden.' }, { status: 500 });
}
