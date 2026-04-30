import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Nur Admins können App-Einstellungen lesen/ändern
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.role || session.user.role !== 'ADMIN') {
    return null;
  }
  return session;
}

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let appSettings = await prisma.appSettings.findFirst();
    
    // Falls keine Einstellungen existieren, erstelle Standardwerte
    if (!appSettings) {
      appSettings = await prisma.appSettings.create({
        data: {
          allowRegistration: false,
        },
      });
    }

    return NextResponse.json(appSettings);
  } catch (error) {
    console.error('Error fetching app settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { allowRegistration } = await request.json();

    let appSettings = await prisma.appSettings.findFirst();

    if (appSettings) {
      appSettings = await prisma.appSettings.update({
        where: { id: appSettings.id },
        data: { allowRegistration },
      });
    } else {
      appSettings = await prisma.appSettings.create({
        data: { allowRegistration },
      });
    }

    return NextResponse.json(appSettings);
  } catch (error) {
    console.error('Error updating app settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
