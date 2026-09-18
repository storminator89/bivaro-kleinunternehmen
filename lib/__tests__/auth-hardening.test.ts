import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "./helpers/database";

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!state.client) throw new Error("test database is not ready");
    return state.client;
  },
}));
vi.mock("@/lib/audit-log", () => ({
  createAuditLog: vi.fn(),
  auditSecurityEvent: vi.fn(),
}));

import {
  registerUserAtomically,
  RegistrationClosedError,
} from "@/lib/auth-registration";
import { consumeRateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/lib/auth";

let database: ReturnType<typeof createTestDatabase>;

beforeAll(() => {
  database = createTestDatabase();
  state.client = database.client;
}, 40_000);

afterAll(async () => {
  await database?.cleanup();
});

describe("authentication hardening", () => {
  it("allows exactly one administrator during parallel bootstrap registration", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        registerUserAtomically({
          email: `parallel-${index}@test.invalid`,
          name: `Parallel ${index}`,
          passwordHash: "precomputed-test-hash",
        }),
      ),
    );

    const users = await database.client.user.findMany({ orderBy: { email: "asc" } });
    const successful = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
    );

    expect(successful).toHaveLength(1);
    expect(users).toHaveLength(1);
    expect(users[0]?.role).toBe("ADMIN");
    expect(users[0]?.email).toMatch(/^parallel-\d+@test\.invalid$/);
    expect(rejected.every((attempt) => attempt.reason instanceof RegistrationClosedError)).toBe(true);
    expect(await database.client.appSettings.count()).toBe(1);
  }, 40_000);

  it("shares a bounded SQLite limiter across concurrent callers", async () => {
    const decisions = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumeRateLimit(
          "test:shared-login-bucket",
          { limit: 5, windowMs: 60_000, blockMs: 60_000 },
        ),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(7);
    expect(decisions.filter((decision) => decision.remaining === 0)).not.toHaveLength(0);
  }, 40_000);

  it("revokes a JWT when the database session generation changes", async () => {
    const user = await database.client.user.create({
      data: {
        email: "session-revocation@test.invalid",
        password: "unused",
        role: "ADMIN",
      },
    });

    const jwt = authOptions.callbacks?.jwt;
    expect(jwt).toBeDefined();
    if (!jwt) throw new Error("JWT callback missing");

    const token = await jwt({
      token: { id: "", role: "USER", sessionVersion: 0 },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: "ADMIN",
        sessionVersion: user.sessionVersion,
      },
      account: null,
      profile: undefined,
      trigger: "signIn",
      isNewUser: false,
      session: undefined,
    });
    expect(token.revoked).toBe(false);
    expect(token.role).toBe("ADMIN");

    await database.client.user.update({
      where: { id: user.id },
      data: { role: "USER", sessionVersion: { increment: 1 } },
    });

    const revoked = await jwt({
      token,
      user: undefined,
      account: null,
      profile: undefined,
      trigger: undefined,
      isNewUser: false,
      session: undefined,
    } as never);
    expect(revoked.revoked).toBe(true);

    const legacyRevoked = await jwt({
      token: { id: user.id, role: "USER" },
      user: undefined,
      account: null,
      profile: undefined,
      trigger: undefined,
      isNewUser: false,
      session: undefined,
    } as never);
    expect(legacyRevoked.revoked).toBe(true);

    const session = authOptions.callbacks?.session;
    expect(session).toBeDefined();
    if (!session) throw new Error("Session callback missing");
    const exposed = await session({
      session: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: "ADMIN",
          sessionVersion: user.sessionVersion,
        },
        expires: new Date(Date.now() + 60_000).toISOString(),
      },
      token: revoked,
      user: {} as never,
      newSession: undefined,
      trigger: "update",
    });
    expect("user" in exposed).toBe(false);
  });

  it("revokes a JWT after an administrator resets a password", async () => {
    const user = await database.client.user.create({
      data: {
        email: "password-revocation@test.invalid",
        password: "old-hash",
        role: "USER",
      },
    });
    const jwt = authOptions.callbacks?.jwt;
    if (!jwt) throw new Error("JWT callback missing");

    const token = await jwt({
      token: { id: "", role: "USER", sessionVersion: 0 },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: "USER",
        sessionVersion: user.sessionVersion,
      },
      account: null,
      profile: undefined,
      trigger: "signIn",
      isNewUser: false,
      session: undefined,
    });
    await database.client.user.update({
      where: { id: user.id },
      data: { password: "new-hash", sessionVersion: { increment: 1 } },
    });

    const revoked = await jwt({
      token,
      user: undefined,
      account: null,
      profile: undefined,
      trigger: undefined,
      isNewUser: false,
      session: undefined,
    } as never);
    expect(revoked.revoked).toBe(true);
  });
});
