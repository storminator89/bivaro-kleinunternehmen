import { NextRequest, NextResponse } from "next/server";
import { validatePassword, isValidEmail, sanitizeString } from "@/lib/security";
import { hashPassword } from "@/lib/password";
import { auditSecurityEvent } from "@/lib/audit-log";
import {
  registerUserAtomically,
  BootstrapVerificationError,
  RegistrationClosedError,
  RegistrationEmailTakenError,
} from "@/lib/auth-registration";
import { consumeRateLimit, getTrustedClientIp } from "@/lib/rate-limit";

const REGISTRATION_RATE_LIMIT = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 30 * 60 * 1000,
};

export async function POST(request: NextRequest) {
  try {
    const clientIp = getTrustedClientIp(request.headers);
    const rateLimit = await consumeRateLimit(
      `registration:ip:${clientIp}`,
      REGISTRATION_RATE_LIMIT,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          message: "Zu viele Registrierungsversuche. Bitte versuchen Sie es später erneut.",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const body = await request.json();
    const rawEmail = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const name = typeof body?.name === "string" ? body.name : "";
    const setupToken = typeof body?.setupToken === "string" ? body.setupToken : undefined;
    const email = rawEmail.trim().toLowerCase();

    if (!email || !password) {
      return NextResponse.json(
        { message: "Email und Passwort sind erforderlich" },
        { status: 400 },
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { message: "Ungültige E-Mail-Adresse" },
        { status: 400 },
      );
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { message: passwordValidation.message },
        { status: 400 },
      );
    }

    // bcrypt is intentionally outside the short transaction.  The transaction
    // re-checks bootstrap state and the unique email immediately before insert.
    const passwordHash = await hashPassword(password);
    const result = await registerUserAtomically({
      email,
      name: sanitizeString(name, 100) || null,
      passwordHash,
      setupToken,
    });

    await auditSecurityEvent(result.user.id, {
      event: "AUTH_REGISTRATION",
      outcome: "success",
      severity: result.firstUser ? "warning" : "info",
      metadata: {
        firstUser: result.firstUser,
        role: result.user.role,
      },
    });

    const { sessionVersion: _sessionVersion, ...publicUser } = result.user;
    return NextResponse.json(
      {
        message: result.firstUser
          ? "Admin-Konto erfolgreich erstellt"
          : "Registrierung erfolgreich",
        user: publicUser,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RegistrationClosedError) {
      return NextResponse.json(
        { message: error.message },
        { status: 403 },
      );
    }

    if (error instanceof BootstrapVerificationError) {
      return NextResponse.json(
        { message: error.message },
        { status: 403 },
      );
    }

    if (error instanceof RegistrationEmailTakenError) {
      return NextResponse.json(
        { message: error.message },
        { status: 409 },
      );
    }

    console.error("Registration error:", error);
    return NextResponse.json(
      { message: "Ein Fehler ist bei der Registrierung aufgetreten" },
      { status: 500 },
    );
  }
}
