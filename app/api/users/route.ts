import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { isValidEmail, sanitizeString, validatePassword } from "@/lib/security";
import { isValidRole, UserRole } from "@/lib/auth";
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdminSession,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/get-user-id";
import { auditCreate, auditSecurityEvent } from "@/lib/audit-log";

function parseRole(value: unknown, fallback: UserRole = "USER"): UserRole | null {
  if (value === undefined) return fallback;
  return isValidRole(value) ? value : null;
}

function authErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof ForbiddenError) return forbiddenResponse();
  return null;
}

export async function GET() {
  try {
    await requireAdminSession();

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        deactivatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(users);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("[USERS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user: actor } = await requireAdminSession();
    const body = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role = parseRole(body?.role);

    if (!email || !password) {
      return new NextResponse("Missing required fields", { status: 400 });
    }
    if (!isValidEmail(email)) {
      return new NextResponse("Invalid email", { status: 400 });
    }
    if (!role) {
      return new NextResponse("Invalid role", { status: 400 });
    }
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json({ message: passwordValidation.message }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return new NextResponse("Email already exists", { status: 409 });

    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        name: sanitizeString(typeof body?.name === "string" ? body.name : "", 100) || null,
        email,
        password: hashedPassword,
        role,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    await auditCreate(actor.id, "User", user, user.email);
    await auditSecurityEvent(actor.id, {
      event: "ADMIN_USER_CHANGE",
      outcome: "success",
      severity: "info",
      metadata: { action: "CREATE", targetUserId: user.id, role: user.role },
    });

    return NextResponse.json(user);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new NextResponse("Email already exists", { status: 409 });
    }
    console.error("[USERS_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
