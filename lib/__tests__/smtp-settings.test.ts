import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "./helpers/database";

const state = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  admin: true,
  actor: { id: "smtp-admin" },
}));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!state.client) throw new Error("test database is not ready");
    return state.client;
  },
}));
vi.mock("@/lib/audit-log", () => ({ auditSecurityEvent: vi.fn() }));
vi.mock("@/lib/get-user-id", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    unauthorizedResponse: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    forbiddenResponse: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    requireAdminSession: async () => {
      if (!state.admin) throw new ForbiddenError();
      return { user: state.actor };
    },
  };
});

import { DELETE, GET, PUT } from "@/app/api/settings/smtp/route";
import { resolveSmtpConfiguration } from "@/lib/smtp-settings";

let database: ReturnType<typeof createTestDatabase>;

beforeAll(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "smtp-test-key-material");
  database = createTestDatabase();
  state.client = database.client;
}, 40_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.cleanup();
});

beforeEach(async () => {
  state.admin = true;
  vi.stubEnv("NEXTAUTH_SECRET", "smtp-test-key-material");
  await database.client.smtpSettings.deleteMany();
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("SMTP_PORT", "");
  vi.stubEnv("SMTP_SECURE", "");
  vi.stubEnv("SMTP_USER", "");
  vi.stubEnv("SMTP_PASSWORD", "");
  vi.stubEnv("EMAIL_FROM", "");
});

function request(body: unknown) {
  return new Request("http://localhost/api/settings/smtp", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validSettings = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  from: "Bivaro <billing@example.test>",
  user: "mailer@example.test",
};

describe("SMTP settings", () => {
  it("requires an administrator for all settings operations", async () => {
    state.admin = false;
    expect((await GET()).status).toBe(403);
    expect((await PUT(request(validSettings))).status).toBe(403);
    expect((await DELETE()).status).toBe(403);
  });

  it("validates host, port, sender headers and authentication input", async () => {
    expect((await PUT(request({ ...validSettings, host: "smtp\n.invalid" }))).status).toBe(400);
    expect((await PUT(request({ ...validSettings, port: 0 }))).status).toBe(400);
    expect((await PUT(request({ ...validSettings, from: "Billing\r\nBcc: leak@example.test" }))).status).toBe(400);
    expect((await PUT(request({ ...validSettings, password: "" }))).status).toBe(400);
  });

  it("encrypts the password and never returns credential material", async () => {
    const response = await PUT(request({ ...validSettings, password: "db-password-fixture" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "configured", "from", "host", "passwordConfigured", "port", "secure", "source", "user",
    ]);
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("passwordCiphertext");
    expect(body.passwordConfigured).toBe(true);

    const stored = await database.client.smtpSettings.findUniqueOrThrow({ where: { singletonKey: "global" } });
    expect(stored.passwordCiphertext).toBeTruthy();
    expect(stored.passwordCiphertext).not.toContain("db-password-fixture");
    expect(stored.passwordIv).toBeTruthy();
    expect(stored.passwordTag).toBeTruthy();
    const status = await (await GET()).json();
    expect(status).not.toHaveProperty("password");
  });

  it("retains a stored password when omitted or empty, then clears it with an empty user", async () => {
    await PUT(request({ ...validSettings, password: "retained-password" }));
    const before = await database.client.smtpSettings.findUniqueOrThrow({ where: { singletonKey: "global" } });

    const retained = await PUT(request({ ...validSettings, password: "" }));
    expect((await retained.json()).passwordConfigured).toBe(true);
    const afterRetain = await database.client.smtpSettings.findUniqueOrThrow({ where: { singletonKey: "global" } });
    expect(afterRetain.passwordCiphertext).toBe(before.passwordCiphertext);

    const cleared = await PUT(request({ ...validSettings, user: "", password: "" }));
    expect((await cleared.json()).passwordConfigured).toBe(false);
    const afterClear = await database.client.smtpSettings.findUniqueOrThrow({ where: { singletonKey: "global" } });
    expect(afterClear.user).toBeNull();
    expect(afterClear.passwordCiphertext).toBeNull();
  });

  it("uses environment fallback after deleting the database override", async () => {
    vi.stubEnv("SMTP_HOST", "env.smtp.example.test");
    vi.stubEnv("SMTP_PORT", "465");
    vi.stubEnv("SMTP_SECURE", "true");
    vi.stubEnv("SMTP_USER", "env-user");
    vi.stubEnv("SMTP_PASSWORD", "env-password-fixture");
    vi.stubEnv("EMAIL_FROM", "env@example.test");
    await PUT(request({ ...validSettings, password: "db-password-fixture" }));

    const response = await DELETE();
    const body = await response.json();
    expect(body).toMatchObject({ source: "environment", host: "env.smtp.example.test", port: 465, secure: true, from: "env@example.test", user: "env-user", passwordConfigured: true });
    expect(body).not.toHaveProperty("password");
    expect(await database.client.smtpSettings.count()).toBe(0);
  });

  it("accepts a password from the environment when creating the first database override", async () => {
    vi.stubEnv("SMTP_PASSWORD", "env-password-fixture");
    const response = await PUT(request(validSettings));
    expect(response.status).toBe(200);
    expect((await response.json()).passwordConfigured).toBe(true);
    expect((await resolveSmtpConfiguration()).auth).toEqual({ user: validSettings.user, pass: "env-password-fixture" });
  });

  it("reports a readable error when the encryption secret is unavailable or rotated", async () => {
    await PUT(request({ ...validSettings, password: "db-password-fixture" }));
    vi.stubEnv("NEXTAUTH_SECRET", "");
    await expect(resolveSmtpConfiguration()).rejects.toThrow("NEXTAUTH_SECRET muss");
    vi.stubEnv("NEXTAUTH_SECRET", "different-secret");
    await expect(resolveSmtpConfiguration()).rejects.toThrow("kann nicht entschlüsselt werden");
  });
});
