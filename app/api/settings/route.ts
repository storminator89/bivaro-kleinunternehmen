import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await prisma.settings.findUnique({
      where: { userId },
    });
    return NextResponse.json(settings || {});
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const { companyName, companyAddress, email, telephone, taxNumber, bankName, iban, bic, footerText, logoUrl } = body;

    const settings = await prisma.settings.upsert({
      where: { userId },
      update: {
        companyName,
        companyAddress,
        email,
        telephone,
        taxNumber,
        bankName,
        iban,
        bic,
        footerText,
        logoUrl,
      },
      create: {
        userId,
        companyName,
        companyAddress,
        email,
        telephone,
        taxNumber,
        bankName,
        iban,
        bic,
        footerText,
        logoUrl,
      },
    });

    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
