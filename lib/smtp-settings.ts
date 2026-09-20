import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const SMTP_SETTINGS_KEY = "global";

export type SmtpSource = "database" | "environment" | "none";

export type SmtpSettingsStatus = {
  source: SmtpSource;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  from: string | null;
  user: string | null;
  passwordConfigured: boolean;
  configured: boolean;
};

export type SmtpRuntimeConfiguration = SmtpSettingsStatus & {
  auth?: { user: string; pass: string };
};

export type SmtpSettingsInput = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user: string;
  password?: string;
};

export class SmtpSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpSettingsValidationError";
  }
}

export class SmtpSecretConfigurationError extends Error {
  constructor() {
    super("NEXTAUTH_SECRET muss für gespeicherte SMTP-Passwörter gesetzt sein");
    this.name = "SmtpSecretConfigurationError";
  }
}

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;
const HOST_PATTERN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/u;
const ENCRYPTION_CONTEXT = "bivaro:smtp-password:aes-256-gcm:v1";

function encryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || !secret.trim()) throw new SmtpSecretConfigurationError();
  return createHash("sha256").update(ENCRYPTION_CONTEXT).update("\0").update(secret).digest();
}

function encryptPassword(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return {
    passwordCiphertext: ciphertext.toString("base64"),
    passwordIv: iv.toString("base64"),
    passwordTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptPassword(values: {
  passwordCiphertext: string | null;
  passwordIv: string | null;
  passwordTag: string | null;
}): string {
  if (!values.passwordCiphertext || !values.passwordIv || !values.passwordTag) {
    throw new SmtpSettingsValidationError("Gespeichertes SMTP-Passwort ist unvollständig");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(values.passwordIv, "base64"));
    decipher.setAuthTag(Buffer.from(values.passwordTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(values.passwordCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof SmtpSecretConfigurationError) throw error;
    throw new SmtpSettingsValidationError("Gespeichertes SMTP-Passwort kann nicht entschlüsselt werden; Passwort unter Einstellungen erneut eingeben");
  }
}

function validHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && !/[\r\n\s/\\@]/u.test(host) && HOST_PATTERN.test(host);
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function validFrom(from: string): boolean {
  if (from.length === 0 || from.length > 320 || /[\r\n]/u.test(from)) return false;
  if (EMAIL_PATTERN.test(from)) return true;
  const match = /^([^<>\r\n]{1,240})\s<([^<>\r\n]+)>$/u.exec(from);
  return Boolean(match && EMAIL_PATTERN.test(match[2]));
}

function normalizeInput(input: SmtpSettingsInput): SmtpSettingsInput {
  const host = input.host.trim();
  const from = input.from.trim();
  const user = input.user.trim();
  if (!validHost(host)) throw new SmtpSettingsValidationError("SMTP-Host ist ungültig");
  if (!validPort(input.port)) throw new SmtpSettingsValidationError("SMTP-Port ist ungültig");
  if (typeof input.secure !== "boolean") throw new SmtpSettingsValidationError("SMTP-Secure muss boolesch sein");
  if (!validFrom(from)) throw new SmtpSettingsValidationError("Absenderadresse ist ungültig");
  if (/[\r\n]/u.test(user) || user.length > 320) throw new SmtpSettingsValidationError("SMTP-Benutzer ist ungültig");
  if (input.password !== undefined && input.password.length > 4096) {
    throw new SmtpSettingsValidationError("SMTP-Passwort ist zu lang");
  }
  return { ...input, host, from, user };
}

function hasEnvironmentConfiguration(): boolean {
  return ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]
    .some((key) => typeof process.env[key] === "string" && process.env[key] !== "");
}

function environmentValues(fallbackFrom?: string | null) {
  const host = process.env.SMTP_HOST?.trim() || null;
  const rawPort = process.env.SMTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : host ? 587 : null;
  const secure = host || rawPort
    ? process.env.SMTP_SECURE === undefined
      ? port === 465
      : process.env.SMTP_SECURE === "true"
    : null;
  const user = process.env.SMTP_USER?.trim() || null;
  const password = process.env.SMTP_PASSWORD || null;
  const from = process.env.EMAIL_FROM?.trim() || fallbackFrom?.trim() || user || null;
  return {
    source: hasEnvironmentConfiguration() ? "environment" as const : "none" as const,
    host,
    port: port !== null && validPort(port) ? port : null,
    secure,
    from,
    user,
    password,
    passwordConfigured: Boolean(password),
  };
}

function statusFromValues(values: {
  source: SmtpSource;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  from: string | null;
  user: string | null;
  passwordConfigured: boolean;
}): SmtpSettingsStatus {
  const complete = Boolean(
    values.host && validHost(values.host) && values.port !== null && validPort(values.port)
      && values.secure !== null && values.from && validFrom(values.from)
      && ((values.user && values.passwordConfigured) || (!values.user && !values.passwordConfigured)),
  );
  return {
    source: values.source,
    host: values.host,
    port: values.port,
    secure: values.secure,
    from: values.from,
    user: values.user,
    passwordConfigured: values.passwordConfigured,
    configured: complete,
  };
}

export async function getSmtpSettingsStatus(fallbackFrom?: string | null): Promise<SmtpSettingsStatus> {
  const stored = await prisma.smtpSettings.findUnique({ where: { singletonKey: SMTP_SETTINGS_KEY } });
  if (!stored) {
    const values = environmentValues(fallbackFrom);
    return statusFromValues(values);
  }
  return statusFromValues({
    source: "database",
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    from: stored.from,
    user: stored.user,
    passwordConfigured: Boolean(stored.passwordCiphertext),
  });
}

export async function resolveSmtpConfiguration(fallbackFrom?: string | null): Promise<SmtpRuntimeConfiguration> {
  const stored = await prisma.smtpSettings.findUnique({ where: { singletonKey: SMTP_SETTINGS_KEY } });
  if (!stored) {
    const values = environmentValues(fallbackFrom);
    const status = statusFromValues(values);
    return {
      ...status,
      auth: values.user && values.password ? { user: values.user, pass: values.password } : undefined,
    };
  }

  const password = stored.passwordCiphertext ? decryptPassword(stored) : null;
  const status = statusFromValues({
    source: "database",
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    from: stored.from,
    user: stored.user,
    passwordConfigured: Boolean(stored.passwordCiphertext),
  });
  return {
    ...status,
    auth: stored.user && password ? { user: stored.user, pass: password } : undefined,
  };
}

export async function saveSmtpSettings(input: SmtpSettingsInput): Promise<SmtpSettingsStatus> {
  const normalized = normalizeInput(input);
  const existing = await prisma.smtpSettings.findUnique({ where: { singletonKey: SMTP_SETTINGS_KEY } });
  const clearPassword = normalized.user.length === 0;
  const newPassword = !clearPassword && normalized.password !== undefined && normalized.password.length > 0
    ? encryptPassword(normalized.password)
    : null;
  const passwordFields = clearPassword
    ? { passwordCiphertext: null, passwordIv: null, passwordTag: null }
    : newPassword
      || (existing?.passwordCiphertext
        ? {
          passwordCiphertext: existing.passwordCiphertext,
          passwordIv: existing.passwordIv,
          passwordTag: existing.passwordTag,
        }
        : !existing && process.env.SMTP_PASSWORD
          ? encryptPassword(process.env.SMTP_PASSWORD)
          : null);
  if (!clearPassword && !passwordFields && normalized.user.length > 0) {
    throw new SmtpSettingsValidationError("SMTP-Passwort ist für einen SMTP-Benutzer erforderlich");
  }

  await prisma.smtpSettings.upsert({
    where: { singletonKey: SMTP_SETTINGS_KEY },
    update: {
      host: normalized.host,
      port: normalized.port,
      secure: normalized.secure,
      from: normalized.from,
      user: normalized.user || null,
      ...passwordFields,
    },
    create: {
      singletonKey: SMTP_SETTINGS_KEY,
      host: normalized.host,
      port: normalized.port,
      secure: normalized.secure,
      from: normalized.from,
      user: normalized.user || null,
      ...passwordFields,
    },
  });
  return getSmtpSettingsStatus();
}

export async function deleteSmtpSettings(): Promise<SmtpSettingsStatus> {
  await prisma.smtpSettings.deleteMany({ where: { singletonKey: SMTP_SETTINGS_KEY } });
  return getSmtpSettingsStatus();
}
