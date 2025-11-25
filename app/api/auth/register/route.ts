import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

    // Validation
    if (!email || !password) {
      return NextResponse.json(
        { message: "Email und Passwort sind erforderlich" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { message: "Passwort muss mindestens 6 Zeichen lang sein" },
        { status: 400 }
      );
    }

    // Prüfen ob überhaupt User existieren
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;

    // Wenn nicht der erste User, prüfe ob Registrierung erlaubt ist
    if (!isFirstUser) {
      const appSettings = await prisma.appSettings.findFirst();
      if (appSettings && !appSettings.allowRegistration) {
        return NextResponse.json(
          { message: "Registrierung ist deaktiviert" },
          { status: 403 }
        );
      }
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "E-Mail wird bereits verwendet" },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user - erster User wird automatisch ADMIN
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: isFirstUser ? "ADMIN" : "USER",
      },
    });

    // Wenn erster User, erstelle AppSettings mit deaktivierter Registrierung
    if (isFirstUser) {
      await prisma.appSettings.create({
        data: {
          allowRegistration: false,
        },
      });
    }

    // Return the user without password
    const { password: _, ...userWithoutPassword } = user;
    
    return NextResponse.json(
      { 
        message: isFirstUser 
          ? "Admin-Konto erfolgreich erstellt" 
          : "Registrierung erfolgreich", 
        user: userWithoutPassword 
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { message: "Ein Fehler ist bei der Registrierung aufgetreten" },
      { status: 500 }
    );
  }
}