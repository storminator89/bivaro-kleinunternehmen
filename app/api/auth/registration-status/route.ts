import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;

    // Wenn erster User, Registrierung immer erlaubt
    if (isFirstUser) {
      return NextResponse.json({
        isFirstUser: true,
        allowRegistration: true,
      });
    }

    // Ansonsten App-Einstellungen prüfen
    const appSettings = await prisma.appSettings.findFirst();
    
    return NextResponse.json({
      isFirstUser: false,
      allowRegistration: appSettings?.allowRegistration ?? false,
    });
  } catch (error) {
    console.error("Error checking registration status:", error);
    return NextResponse.json(
      { error: "Failed to check registration status" },
      { status: 500 }
    );
  }
}
