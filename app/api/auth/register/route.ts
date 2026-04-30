import { NextResponse, NextRequest } from "next/server";
import { prisma } from '@/lib/prisma';
import { validatePassword, isValidEmail, sanitizeString } from "@/lib/security";
import { hashPassword } from "@/lib/password";
import { auditSecurityEvent } from "@/lib/audit-log";

// Rate limiting for registration
const registrationAttempts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REGISTRATION_ATTEMPTS = 5;

function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         request.headers.get('x-real-ip') || 
         'unknown';
}

function checkRegistrationRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = registrationAttempts.get(ip);
  
  if (!record || now > record.resetTime) {
    registrationAttempts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (record.count >= MAX_REGISTRATION_ATTEMPTS) {
    return false;
  }
  
  record.count++;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientIP = getClientIP(request);
    if (!checkRegistrationRateLimit(clientIP)) {
      return NextResponse.json(
        { message: "Zu viele Registrierungsversuche. Bitte versuchen Sie es später erneut." },
        { status: 429 }
      );
    }

    const { name, email, password } = await request.json();

    // Validation
    if (!email || !password) {
      return NextResponse.json(
        { message: "Email und Passwort sind erforderlich" },
        { status: 400 }
      );
    }

    // Email validation
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { message: "Ungültige E-Mail-Adresse" },
        { status: 400 }
      );
    }

    // Password strength validation
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { message: passwordValidation.message },
        { status: 400 }
      );
    }

    // Sanitize name
    const sanitizedName = sanitizeString(name || '', 100);

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
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "E-Mail wird bereits verwendet" },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);

    // Create user - erster User wird automatisch ADMIN
    const user = await prisma.user.create({
      data: {
        name: sanitizedName || null,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: isFirstUser ? "ADMIN" : "USER",
      },
    });
    await auditSecurityEvent(user.id, {
      event: 'AUTH_REGISTRATION',
      outcome: 'success',
      severity: isFirstUser ? 'warning' : 'info',
      metadata: {
        firstUser: isFirstUser,
        role: user.role,
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
