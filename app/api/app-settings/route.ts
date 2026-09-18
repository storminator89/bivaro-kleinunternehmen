import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditSecurityEvent, createAuditLog } from "@/lib/audit-log";
import { APP_SETTINGS_KEY } from "@/lib/auth-registration";
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdminSession,
  UnauthorizedError,
  unauthorizedResponse,
} from "@/lib/get-user-id";

function authErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof ForbiddenError) return forbiddenResponse();
  return null;
}
export async function GET() {
  try {
    await requireAdminSession();
    const appSettings = await prisma.appSettings.upsert({
      where: { singletonKey: APP_SETTINGS_KEY },
      update: {},
      create: {
        singletonKey: APP_SETTINGS_KEY,
        allowRegistration: false,
      },
    });
    return NextResponse.json(appSettings);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Error fetching app settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { user: actor } = await requireAdminSession();
    const body = await request.json();
    if (typeof body?.allowRegistration !== "boolean") {
      return NextResponse.json(
        { error: "allowRegistration must be a boolean" },
        { status: 400 },
      );
    }

    const before = await prisma.appSettings.findUnique({
      where: { singletonKey: APP_SETTINGS_KEY },
    });
    const appSettings = await prisma.appSettings.upsert({
      where: { singletonKey: APP_SETTINGS_KEY },
      update: { allowRegistration: body.allowRegistration },
      create: {
        singletonKey: APP_SETTINGS_KEY,
        allowRegistration: body.allowRegistration,
      },
    });

    await createAuditLog({
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      entityType: "Settings",
      entityId: appSettings.id,
      oldValues: before ? { allowRegistration: before.allowRegistration } : undefined,
      newValues: { allowRegistration: appSettings.allowRegistration },
      metadata: { setting: "allowRegistration" },
    });
    await auditSecurityEvent(actor.id, {
      event: "AUTH_REGISTRATION_SETTINGS_CHANGED",
      outcome: "success",
      severity: "warning",
      metadata: {
        allowRegistration: appSettings.allowRegistration,
      },
    });

    return NextResponse.json(appSettings);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Error updating app settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
