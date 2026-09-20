import { NextResponse } from "next/server";
import { auditSecurityEvent } from "@/lib/audit-log";
import {
  deleteSmtpSettings,
  getSmtpSettingsStatus,
  saveSmtpSettings,
  SmtpSecretConfigurationError,
  SmtpSettingsValidationError,
} from "@/lib/smtp-settings";
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
    return NextResponse.json(await getSmtpSettingsStatus());
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("SMTP-Einstellungen konnten nicht gelesen werden");
    return NextResponse.json({ error: "SMTP-Einstellungen konnten nicht gelesen werden" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { user: actor } = await requireAdminSession();
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Ungültige SMTP-Einstellungen" }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    if (
      typeof data.host !== "string" ||
      typeof data.port !== "number" ||
      typeof data.secure !== "boolean" ||
      typeof data.from !== "string" ||
      typeof data.user !== "string" ||
      (data.password !== undefined && typeof data.password !== "string")
    ) {
      return NextResponse.json({ error: "host, port, secure, from und user sind erforderlich" }, { status: 400 });
    }

    const status = await saveSmtpSettings({
      host: data.host,
      port: data.port,
      secure: data.secure,
      from: data.from,
      user: data.user,
      password: data.password,
    });
    await auditSecurityEvent(actor.id, {
      event: "AUTH_SMTP_SETTINGS_CHANGED",
      outcome: "success",
      severity: "warning",
      metadata: { operation: "update", source: status.source, configured: status.configured },
    });
    return NextResponse.json(status);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof SmtpSettingsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SmtpSecretConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
    }
    console.error("SMTP-Einstellungen konnten nicht gespeichert werden");
    return NextResponse.json({ error: "SMTP-Einstellungen konnten nicht gespeichert werden" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { user: actor } = await requireAdminSession();
    const status = await deleteSmtpSettings();
    await auditSecurityEvent(actor.id, {
      event: "AUTH_SMTP_SETTINGS_CHANGED",
      outcome: "success",
      severity: "warning",
      metadata: { operation: "delete", source: status.source, configured: status.configured },
    });
    return NextResponse.json(status);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("SMTP-Datenbankoverride konnte nicht entfernt werden");
    return NextResponse.json({ error: "SMTP-Datenbankoverride konnte nicht entfernt werden" }, { status: 500 });
  }
}
