import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const templates = await prisma.invoiceTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(templates);
  } catch (error) {
    console.error('Error fetching invoice templates:', error);
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, data } = body;

    if (!name || !data) {
      return NextResponse.json({ error: 'Name and data are required' }, { status: 400 });
    }

    const template = await prisma.invoiceTemplate.create({
      data: {
        name,
        data,
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    console.error('Error creating invoice template:', error);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}
