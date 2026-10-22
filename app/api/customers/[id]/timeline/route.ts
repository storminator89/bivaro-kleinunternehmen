import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { CustomerTimelineError, readCustomerTimeline } from '@/lib/customer-timeline';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const url = new URL(request.url);
    if (Array.from(url.searchParams.keys()).some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1) {
      throw new CustomerTimelineError('Ungültige Verlaufsabfrage.');
    }
    const page = await readCustomerTimeline(userId, Number(id), url.searchParams.get('cursor'));
    return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    if (error instanceof CustomerTimelineError) return NextResponse.json({ error: error.message }, { status: error.status });
    // Do not log financial documents, cursor contents or database diagnostics.
    return NextResponse.json({ error: 'Der Kundenverlauf konnte nicht geladen werden. Bitte erneut versuchen.' }, { status: 500 });
  }
}
