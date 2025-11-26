import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const userId = await requireUserId();
    const customers = await prisma.customer.findMany({
      where: { userId },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return NextResponse.json(customers);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error fetching customers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const { name, email, address, zipCode, city, taxNumber, contactPerson } = await request.json();

    if (!name) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
    }

    const newCustomer = await prisma.customer.create({
      data: {
        name,
        email: email || null,
        address: address || null,
        zipCode: zipCode || null,
        city: city || null,
        taxNumber: taxNumber || null,
        contactPerson: contactPerson || null,
        userId,
      },
    });
    return NextResponse.json(newCustomer);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error creating customer:', error);
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const { id, name, email, address, zipCode, city, taxNumber, contactPerson } = await request.json();

    if (!id || !name) {
      return NextResponse.json({ error: 'Customer ID and name are required' }, { status: 400 });
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: Number(id), userId },
      data: {
        name,
        email: email || null,
        address: address || null,
        zipCode: zipCode || null,
        city: city || null,
        taxNumber: taxNumber || null,
        contactPerson: contactPerson || null,
      },
    });
    return NextResponse.json(updatedCustomer);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error updating customer:', error);
    return NextResponse.json(
      { error: 'Customer not found or failed to update' },
      { status: 404 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Customer ID is required' }, { status: 400 });
    }

    await prisma.customer.delete({
      where: { id: Number(id), userId },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error deleting customer:', error);
    return NextResponse.json(
      { error: 'Customer not found or failed to delete' },
      { status: 404 }
    );
  }
}
