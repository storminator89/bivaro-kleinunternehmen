import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { ServiceBillingError } from '@/lib/service-billing';
import { reviewServiceBillingPeriod } from '@/lib/service-billing-service';
export const POST = protectMutation(async (request: Request) => {
  try { const userId = await requireUserId(); return NextResponse.json(await reviewServiceBillingPeriod(userId, await request.json())); }
  catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof ServiceBillingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ungültiges JSON.' }, { status: 400 });
    console.error('Service period review failed:', error);
    return NextResponse.json({ error: 'Der Zeitraum konnte nicht verarbeitet werden. Bitte neu laden; ein vorhandener Entwurf wird nicht erneut angelegt.' }, { status: 500 });
  }
}, { maxBodyBytes: 4096 });
