import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { protectMutation } from '@/lib/request-security';
import { ServiceBillingError } from '@/lib/service-billing';
import { createServiceBillingPlan, listServiceBillingPlans, updateServiceBillingPlan } from '@/lib/service-billing-service';

function failure(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof ServiceBillingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ungültiges JSON.' }, { status: 400 });
  console.error('Service plan request failed:', error);
  return NextResponse.json({ error: 'Servicepläne konnten nicht verarbeitet werden. Bitte erneut laden.' }, { status: 500 });
}
export async function GET() {
  try { return NextResponse.json(await listServiceBillingPlans(await requireUserId()), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return failure(error); }
}
export const POST = protectMutation(async (request: Request) => {
  try { const userId = await requireUserId(); return NextResponse.json(await createServiceBillingPlan(userId, await request.json()), { status: 201 }); }
  catch (error) { return failure(error); }
}, { maxBodyBytes: 160 * 1024 });
export const PATCH = protectMutation(async (request: Request) => {
  try { const userId = await requireUserId(); return NextResponse.json(await updateServiceBillingPlan(userId, await request.json())); }
  catch (error) { return failure(error); }
}, { maxBodyBytes: 160 * 1024 });
