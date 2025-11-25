import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const userId = await requireUserId();
    const templates = await prisma.invoiceTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(templates);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error fetching invoice templates:', error);
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const { name, data } = body;

    if (!name || !data) {
      return NextResponse.json({ error: 'Name and data are required' }, { status: 400 });
    }

    const template = await prisma.invoiceTemplate.create({
      data: {
        name,
        data,
        userId,
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error creating invoice template:', error);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}
