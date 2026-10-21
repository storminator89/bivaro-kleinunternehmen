import { NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { prisma } from '@/lib/prisma';
import { readServiceArticle } from '@/lib/service-articles';
export async function GET() {
  try {
    const userId = await requireUserId();
    const rows = await prisma.serviceArticle.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(rows.map(readServiceArticle).filter(Boolean), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    return NextResponse.json({ error: 'Artikel und Leistungen konnten nicht geladen werden.' }, { status: 500 });
  }
}
