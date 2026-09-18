import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isValidRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";

export interface ValidatedSession {
  session: Session;
  user: {
    id: string;
    role: "USER" | "ADMIN";
    sessionVersion: number;
    email: string;
    name: string | null;
  };
}

/**
 * Validate both the NextAuth session and its current database user.  The
 * callback refreshes role data, while this second check protects routes that
 * accidentally receive a manually constructed/stale session object.
 */
export async function getValidatedSession(): Promise<ValidatedSession | null> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user;
  if (
    !session ||
    !sessionUser?.id ||
    !isValidRole(sessionUser.role) ||
    typeof sessionUser.sessionVersion !== "number"
  ) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      role: true,
      sessionVersion: true,
      email: true,
      name: true,
    },
  });

  if (
    !user ||
    !isValidRole(user.role) ||
    user.role !== sessionUser.role ||
    user.sessionVersion !== sessionUser.sessionVersion
  ) {
    return null;
  }

  return {
    session,
    user: {
      id: user.id,
      role: user.role,
      sessionVersion: user.sessionVersion,
      email: user.email,
      name: user.name,
    },
  };
}

export async function getUserId(): Promise<string | null> {
  const validated = await getValidatedSession();
  return validated?.user.id || null;
}

export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) {
    throw new UnauthorizedError();
  }
  return userId;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export async function requireAdminSession(): Promise<ValidatedSession> {
  const validated = await getValidatedSession();
  if (!validated) throw new UnauthorizedError();
  if (validated.user.role !== "ADMIN") throw new ForbiddenError();
  return validated;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
