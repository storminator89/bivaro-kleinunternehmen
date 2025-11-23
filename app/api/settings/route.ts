import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const settings = await prisma.settings.findFirst();
    return NextResponse.json(settings || {});
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyName, companyAddress, taxNumber, bankDetails, footerText, logoUrl } = body;

    // Check if settings exist
    const existingSettings = await prisma.settings.findFirst();

    let settings;
    if (existingSettings) {
      settings = await prisma.settings.update({
        where: { id: existingSettings.id },
        data: {
          companyName,
          companyAddress,
          taxNumber,
          bankDetails,
          footerText,
          logoUrl,
        },
      });
    } else {
      settings = await prisma.settings.create({
        data: {
          companyName,
          companyAddress,
          taxNumber,
          bankDetails,
          footerText,
          logoUrl,
        },
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
