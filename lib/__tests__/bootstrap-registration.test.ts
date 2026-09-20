import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "./helpers/database";

const state = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!state.client) throw new Error("test database is not ready");
    return state.client;
  },
}));

import {
  BootstrapVerificationError,
  registerUserAtomically,
  RegistrationClosedError,
} from "@/lib/auth-registration";
import { GET as registrationStatus } from "@/app/api/auth/registration-status/route";

let database: ReturnType<typeof createTestDatabase>;
const setupToken = "test-bootstrap-token";

beforeAll(() => {
  process.env.BIVARO_SETUP_TOKEN = setupToken;
  database = createTestDatabase();
  state.client = database.client;
}, 40_000);

afterAll(async () => {
  delete process.env.BIVARO_SETUP_TOKEN;
  await database?.cleanup();
});

beforeEach(async () => {
  await database.client.user.deleteMany();
  await database.client.appSettings.deleteMany();
});

function registration(email: string, token?: string) {
  return registerUserAtomically({
    email,
    name: "Bootstrap Test",
    passwordHash: "precomputed-test-hash",
    setupToken: token,
  });
}

describe("one-time first-admin bootstrap", () => {
  it("keeps an empty instance closed without a server token", async () => {
    const configured = process.env.BIVARO_SETUP_TOKEN;
    delete process.env.BIVARO_SETUP_TOKEN;

    try {
      await expect(registration("without-proof@test.invalid", setupToken)).rejects.toBeInstanceOf(
        BootstrapVerificationError,
      );
      const response = await registrationStatus();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        isFirstUser: true,
        allowRegistration: false,
        bootstrapRequired: true,
        bootstrapConsumed: false,
      });
      expect(await database.client.user.count()).toBe(0);
    } finally {
      process.env.BIVARO_SETUP_TOKEN = configured;
    }
  });

  it("consumes a valid token with the first administrator and keeps it consumed", async () => {
    const result = await registration("first-admin@test.invalid", setupToken);
    expect(result.firstUser).toBe(true);
    expect(result.user.role).toBe("ADMIN");

    const settings = await database.client.appSettings.findUnique({ where: { singletonKey: "global" } });
    expect(settings?.bootstrapConsumedAt).toBeInstanceOf(Date);
    expect(settings?.allowRegistration).toBe(false);

    await database.client.user.deleteMany();
    await expect(registration("after-delete@test.invalid", setupToken)).rejects.toBeInstanceOf(
      BootstrapVerificationError,
    );
    expect(await database.client.appSettings.findUnique({ where: { singletonKey: "global" } })).toMatchObject({
      bootstrapConsumedAt: settings?.bootstrapConsumedAt,
    });
  });

  it("rolls the consume marker back when creating the user fails", async () => {
    await database.client.appSettings.create({
      data: { singletonKey: "global", allowRegistration: false },
    });
    await expect(registration(null as unknown as string, setupToken)).rejects.toThrow();
    expect(await database.client.user.count()).toBe(0);
    expect(
      (await database.client.appSettings.findUnique({ where: { singletonKey: "global" } }))
        ?.bootstrapConsumedAt,
    ).toBeNull();

    const result = await registration("after-rollback@test.invalid", setupToken);
    expect(result.user.role).toBe("ADMIN");
  });

  it("keeps the consumed marker effective across a new Prisma client", async () => {
    await registration("before-restart@test.invalid", setupToken);
    // eslint-disable-next-line no-restricted-syntax
    const restartedClient = new PrismaClient({ datasources: { db: { url: database.url } } });
    state.client = restartedClient;

    await restartedClient.user.deleteMany();
    const status = await registrationStatus();
    expect(await status.json()).toMatchObject({
      isFirstUser: true,
      allowRegistration: false,
      bootstrapRequired: false,
      bootstrapConsumed: true,
    });
    await expect(registration("after-restart@test.invalid", setupToken)).rejects.toBeInstanceOf(
      BootstrapVerificationError,
    );
    expect(
      (await restartedClient.appSettings.findUnique({ where: { singletonKey: "global" } }))
        ?.bootstrapConsumedAt,
    ).not.toBeNull();

    await restartedClient.$disconnect();
    state.client = database.client;
  });

  it("creates exactly one administrator for parallel valid bootstrap calls", async () => {
    const attempts = await Promise.allSettled([
      registration("parallel-a@test.invalid", setupToken),
      registration("parallel-b@test.invalid", setupToken),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(await database.client.user.count({ where: { role: "ADMIN" } })).toBe(1);
    expect(await database.client.user.count()).toBe(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(RegistrationClosedError);
  }, 40_000);

  it("allows ordinary registration only after an administrator explicitly enables it", async () => {
    await registration("admin@test.invalid", setupToken);
    await expect(registration("closed@test.invalid")).rejects.toBeInstanceOf(RegistrationClosedError);

    await database.client.appSettings.update({
      where: { singletonKey: "global" },
      data: { allowRegistration: true },
    });
    const result = await registration("ordinary-user@test.invalid");
    expect(result.firstUser).toBe(false);
    expect(result.user.role).toBe("USER");
  });
});
