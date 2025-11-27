/**
 * CORS Settings API
 * 
 * Ermöglicht Benutzern, ihre erlaubten Origins für API-Aufrufe zu verwalten.
 * Diese Origins werden bei API-Anfragen mit dem API-Key des Benutzers geprüft.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { clearCorsCache } from '@/lib/api-auth';

// URL-Validierung
function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    // Nur HTTP/HTTPS erlauben
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    // Kein Pfad erlaubt (nur Origin)
    if (url.pathname !== '/' && url.pathname !== '') {
      return false;
    }
    // Keine Query-Parameter oder Hash
    if (url.search || url.hash) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Origin normalisieren (trailing slash entfernen)
function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.host}`;
}

// GET - Erlaubte Origins abrufen
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const settings = await prisma.settings.findUnique({
      where: { userId: session.user.id },
      select: { allowedOrigins: true },
    });

    let origins: string[] = [];
    if (settings?.allowedOrigins) {
      try {
        origins = JSON.parse(settings.allowedOrigins);
        if (!Array.isArray(origins)) {
          origins = [];
        }
      } catch {
        origins = [];
      }
    }

    return NextResponse.json({
      origins,
      defaultOrigins: ['http://localhost:3000', 'https://localhost:3000'],
      maxOrigins: 20,
    });
  } catch (error) {
    console.error('Error fetching CORS settings:', error);
    return NextResponse.json(
      { error: 'Fehler beim Abrufen der CORS-Einstellungen' },
      { status: 500 }
    );
  }
}

// PUT - Erlaubte Origins aktualisieren
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const body = await request.json();
    const { origins } = body;

    // Validierung
    if (!Array.isArray(origins)) {
      return NextResponse.json(
        { error: 'origins muss ein Array sein' },
        { status: 400 }
      );
    }

    // Maximal 20 Origins erlaubt
    if (origins.length > 20) {
      return NextResponse.json(
        { error: 'Maximal 20 Origins erlaubt' },
        { status: 400 }
      );
    }

    // Validiere und normalisiere alle Origins
    const validatedOrigins: string[] = [];
    const invalidOrigins: string[] = [];

    for (const origin of origins) {
      if (typeof origin !== 'string' || !origin.trim()) {
        continue;
      }

      const trimmedOrigin = origin.trim();
      if (isValidOrigin(trimmedOrigin)) {
        const normalized = normalizeOrigin(trimmedOrigin);
        if (!validatedOrigins.includes(normalized)) {
          validatedOrigins.push(normalized);
        }
      } else {
        invalidOrigins.push(trimmedOrigin);
      }
    }

    if (invalidOrigins.length > 0) {
      return NextResponse.json(
        {
          error: 'Ungültige Origins gefunden',
          invalidOrigins,
          hint: 'Origins müssen vollständige URLs sein (z.B. https://example.com) ohne Pfad',
        },
        { status: 400 }
      );
    }

    // Settings erstellen oder aktualisieren
    await prisma.settings.upsert({
      where: { userId: session.user.id },
      update: { allowedOrigins: JSON.stringify(validatedOrigins) },
      create: {
        userId: session.user.id,
        allowedOrigins: JSON.stringify(validatedOrigins),
      },
    });

    // Cache invalidieren
    clearCorsCache(session.user.id);

    return NextResponse.json({
      success: true,
      origins: validatedOrigins,
      message: `${validatedOrigins.length} Origin(s) gespeichert`,
    });
  } catch (error) {
    console.error('Error updating CORS settings:', error);
    return NextResponse.json(
      { error: 'Fehler beim Speichern der CORS-Einstellungen' },
      { status: 500 }
    );
  }
}

// POST - Einzelne Origin hinzufügen
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const body = await request.json();
    const { origin } = body;

    if (!origin || typeof origin !== 'string') {
      return NextResponse.json(
        { error: 'origin ist erforderlich' },
        { status: 400 }
      );
    }

    const trimmedOrigin = origin.trim();
    if (!isValidOrigin(trimmedOrigin)) {
      return NextResponse.json(
        {
          error: 'Ungültige Origin',
          hint: 'Origin muss eine vollständige URL sein (z.B. https://example.com) ohne Pfad',
        },
        { status: 400 }
      );
    }

    const normalizedOrigin = normalizeOrigin(trimmedOrigin);

    // Aktuelle Origins laden
    const settings = await prisma.settings.findUnique({
      where: { userId: session.user.id },
      select: { allowedOrigins: true },
    });

    let currentOrigins: string[] = [];
    if (settings?.allowedOrigins) {
      try {
        currentOrigins = JSON.parse(settings.allowedOrigins);
        if (!Array.isArray(currentOrigins)) {
          currentOrigins = [];
        }
      } catch {
        currentOrigins = [];
      }
    }

    // Prüfen ob Origin bereits existiert
    if (currentOrigins.includes(normalizedOrigin)) {
      return NextResponse.json(
        { error: 'Diese Origin ist bereits hinzugefügt' },
        { status: 409 }
      );
    }

    // Maximal 20 Origins erlaubt
    if (currentOrigins.length >= 20) {
      return NextResponse.json(
        { error: 'Maximal 20 Origins erlaubt. Bitte entfernen Sie zuerst eine bestehende Origin.' },
        { status: 400 }
      );
    }

    // Neue Origin hinzufügen
    currentOrigins.push(normalizedOrigin);

    await prisma.settings.upsert({
      where: { userId: session.user.id },
      update: { allowedOrigins: JSON.stringify(currentOrigins) },
      create: {
        userId: session.user.id,
        allowedOrigins: JSON.stringify(currentOrigins),
      },
    });

    // Cache invalidieren
    clearCorsCache(session.user.id);

    return NextResponse.json({
      success: true,
      origin: normalizedOrigin,
      origins: currentOrigins,
      message: 'Origin erfolgreich hinzugefügt',
    });
  } catch (error) {
    console.error('Error adding CORS origin:', error);
    return NextResponse.json(
      { error: 'Fehler beim Hinzufügen der Origin' },
      { status: 500 }
    );
  }
}

// DELETE - Einzelne Origin entfernen
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const origin = searchParams.get('origin');

    if (!origin) {
      return NextResponse.json(
        { error: 'origin Parameter ist erforderlich' },
        { status: 400 }
      );
    }

    // Aktuelle Origins laden
    const settings = await prisma.settings.findUnique({
      where: { userId: session.user.id },
      select: { allowedOrigins: true },
    });

    let currentOrigins: string[] = [];
    if (settings?.allowedOrigins) {
      try {
        currentOrigins = JSON.parse(settings.allowedOrigins);
        if (!Array.isArray(currentOrigins)) {
          currentOrigins = [];
        }
      } catch {
        currentOrigins = [];
      }
    }

    // Origin entfernen
    const filteredOrigins = currentOrigins.filter((o) => o !== origin);

    if (filteredOrigins.length === currentOrigins.length) {
      return NextResponse.json(
        { error: 'Origin nicht gefunden' },
        { status: 404 }
      );
    }

    await prisma.settings.update({
      where: { userId: session.user.id },
      data: { allowedOrigins: JSON.stringify(filteredOrigins) },
    });

    // Cache invalidieren
    clearCorsCache(session.user.id);

    return NextResponse.json({
      success: true,
      origins: filteredOrigins,
      message: 'Origin erfolgreich entfernt',
    });
  } catch (error) {
    console.error('Error removing CORS origin:', error);
    return NextResponse.json(
      { error: 'Fehler beim Entfernen der Origin' },
      { status: 500 }
    );
  }
}
