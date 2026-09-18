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
import { auditDelete, auditSecurityEvent, auditUpdate } from "@/lib/audit-log";
import { inTransaction } from "@/lib/db-transaction";

class UserNotFoundError extends Error {}
class LastAdminError extends Error {}

function parseRole(value: unknown, fallback: UserRole): UserRole | null {
  if (value === undefined) return fallback;
  return isValidRole(value) ? value : null;
}

function authErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof ForbiddenError) return forbiddenResponse();
  return null;
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  sessionVersion: true,
} as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user: actor } = await requireAdminSession();
    const { id } = await params;
    const body = await req.json();
    const requestedEmail = body?.email;
    const requestedPassword = typeof body?.password === "string" ? body.password : "";

    const current = await prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
    if (!current) return new NextResponse("User not found", { status: 404 });
    if (!isValidRole(current.role)) return new NextResponse("Invalid role", { status: 500 });

    const nextRole = parseRole(body?.role, current.role);
    if (!nextRole) return new NextResponse("Invalid role", { status: 400 });

    let nextEmail = current.email;
    if (requestedEmail !== undefined) {
      if (typeof requestedEmail !== "string") {
        return new NextResponse("Invalid email", { status: 400 });
      }
      nextEmail = requestedEmail.trim().toLowerCase();
      if (!isValidEmail(nextEmail)) return new NextResponse("Invalid email", { status: 400 });
    }

    let nextName = current.name;
    if (body?.name !== undefined) {
      if (body.name !== null && typeof body.name !== "string") {
        return new NextResponse("Invalid name", { status: 400 });
      }
      nextName = body.name === null ? null : sanitizeString(body.name, 100) || null;
    }

    const passwordChanged = requestedPassword.length > 0;
    if (passwordChanged) {
      const passwordValidation = validatePassword(requestedPassword);
      if (!passwordValidation.valid) {
        return NextResponse.json({ message: passwordValidation.message }, { status: 400 });
      }
    }
    const passwordHash = passwordChanged ? await hashPassword(requestedPassword) : undefined;
    const roleChanged = current.role !== nextRole;
    const emailChanged = current.email !== nextEmail;
    const sessionMustBeRevoked = roleChanged || emailChanged || passwordChanged;

    const result = await inTransaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: userSelect,
      });
      if (!target) throw new UserNotFoundError();
      if (!isValidRole(target.role)) throw new Error("Invalid role");

      if (target.role === "ADMIN" && nextRole !== "ADMIN") {
        const adminCount = await tx.user.count({ where: { role: "ADMIN" } });
        if (adminCount <= 1) throw new LastAdminError();
      }

      const data: Prisma.UserUpdateInput = {
        name: nextName,
        email: nextEmail,
        role: nextRole,
      };
      if (passwordHash) data.password = passwordHash;
      if (sessionMustBeRevoked) data.sessionVersion = { increment: 1 };

      const updated = await tx.user.update({
        where: { id },
        data,
        select: userSelect,
      });
      return { target, updated };
    });

    await auditUpdate(
      actor.id,
      "User",
      result.updated.id,
      result.target,
      result.updated,
      result.updated.email,
    );
    await auditSecurityEvent(actor.id, {
      event: "ADMIN_USER_CHANGE",
      outcome: "success",
      severity: passwordChanged || roleChanged ? "warning" : "info",
      metadata: {
        action: "UPDATE",
        targetUserId: result.updated.id,
        roleChanged,
        passwordChanged,
        emailChanged,
      },
    });
    if (passwordChanged) {
      await auditSecurityEvent(actor.id, {
        event: "AUTH_PASSWORD_CHANGED",
        outcome: "success",
        severity: "warning",
        metadata: { targetUserId: result.updated.id, via: "admin" },
      });
    }
    if (roleChanged) {
      await auditSecurityEvent(actor.id, {
        event: "AUTH_ROLE_CHANGED",
        outcome: "success",
        severity: "warning",
        metadata: {
          targetUserId: result.updated.id,
          oldRole: result.target.role,
          newRole: result.updated.role,
        },
      });
    }

    return NextResponse.json(result.updated);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof UserNotFoundError) return new NextResponse("User not found", { status: 404 });
    if (error instanceof LastAdminError) {
      return new NextResponse("At least one administrator must remain", { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new NextResponse("Email already in use", { status: 409 });
    }
    console.error("[USER_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user: actor } = await requireAdminSession();
    const { id } = await params;

    if (actor.id === id) {
      return new NextResponse("Cannot delete your own account", { status: 400 });
    }

    const deleted = await inTransaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: userSelect,
      });
      if (!target) throw new UserNotFoundError();
      if (!isValidRole(target.role)) throw new Error("Invalid role");

      if (target.role === "ADMIN") {
        const adminCount = await tx.user.count({ where: { role: "ADMIN" } });
        if (adminCount <= 1) throw new LastAdminError();
      }

      await tx.user.delete({ where: { id } });
      return target;
    });

    await auditDelete(actor.id, "User", deleted, deleted.email);
    await auditSecurityEvent(actor.id, {
      event: "ADMIN_USER_CHANGE",
      outcome: "success",
      severity: "warning",
      metadata: { action: "DELETE", targetUserId: id, role: deleted.role },
    });
    await auditSecurityEvent(actor.id, {
      event: "AUTH_USER_DELETED",
      outcome: "success",
      severity: "warning",
      metadata: { targetUserId: id, role: deleted.role },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof UserNotFoundError) return new NextResponse("User not found", { status: 404 });
    if (error instanceof LastAdminError) {
      return new NextResponse("At least one administrator must remain", { status: 400 });
    }
    console.error("[USER_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
