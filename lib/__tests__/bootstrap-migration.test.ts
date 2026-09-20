import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = process.cwd();
const migrationSource = path.join(repositoryRoot, "prisma", "migrations");
const bootstrapMigration = "20260920100000_bootstrap_token";
const prismaCli = path.resolve("node_modules/prisma/build/index.js");
const fixtures: string[] = [];

async function createPreBootstrapFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bivaro-bootstrap-migration-"));
  fixtures.push(directory);
  const prismaDirectory = path.join(directory, "prisma");
  const migrationsDirectory = path.join(prismaDirectory, "migrations");
  mkdirSync(migrationsDirectory, { recursive: true });
  cpSync(path.join(repositoryRoot, "prisma", "schema.prisma"), path.join(prismaDirectory, "schema.prisma"));
  cpSync(path.join(migrationSource, "migration_lock.toml"), path.join(migrationsDirectory, "migration_lock.toml"));
  const baselineName = "00000000000000_legacy_baseline";
  const baselineSql = "-- Existing installation baseline\n";
  mkdirSync(path.join(migrationsDirectory, baselineName));
  writeFileSync(path.join(migrationsDirectory, baselineName, "migration.sql"), baselineSql);
  cpSync(
    path.join(migrationSource, bootstrapMigration),
    path.join(migrationsDirectory, bootstrapMigration),
    { recursive: true },
  );

  const databaseUrl = `file:${path.join(directory, "fixture.db")}`;
  // Build the smallest schema that represents a legacy installation. The
  // migration under test is then the only applied migration, which keeps this
  // check focused on preserving legacy rows and settings.
  // eslint-disable-next-line no-restricted-syntax
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await client.$executeRawUnsafe(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "password" TEXT NOT NULL,
      "name" TEXT,
      "role" TEXT NOT NULL DEFAULT 'USER',
      "sessionVersion" INTEGER NOT NULL DEFAULT 0,
      "deactivatedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "AppSettings" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "singletonKey" TEXT NOT NULL UNIQUE DEFAULT 'global',
      "allowRegistration" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);
  const baselineChecksum = createHash("sha256").update(baselineSql).digest("hex");
  await client.$executeRaw`
    INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
    VALUES ('legacy-baseline', ${baselineChecksum}, CURRENT_TIMESTAMP, ${baselineName}, CURRENT_TIMESTAMP, 1)
  `;
  await client.$disconnect();
  return { directory, prismaDirectory, databaseUrl };
}

function applyBootstrapMigration(fixture: Awaited<ReturnType<typeof createPreBootstrapFixture>>) {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(fixture.prismaDirectory, "schema.prisma")], {
    env: { ...process.env, DATABASE_URL: fixture.databaseUrl },
    stdio: "pipe",
    timeout: 30_000,
  });
}

afterAll(() => {
  for (const directory of fixtures) rmSync(directory, { recursive: true, force: true });
});

describe("bootstrap migration", () => {
  it("preserves existing registration settings while consuming bootstrap for existing users", async () => {
    const fixture = await createPreBootstrapFixture();
    // eslint-disable-next-line no-restricted-syntax
    const client = new PrismaClient({ datasources: { db: { url: fixture.databaseUrl } } });
    const userId = "legacy-admin";
    await client.$executeRaw`
      INSERT INTO "User" ("id", "email", "password", "role")
      VALUES (${userId}, 'legacy-admin@test.invalid', 'legacy-hash', 'ADMIN')
    `;
    await client.$executeRaw`
      INSERT INTO "AppSettings" ("singletonKey", "allowRegistration", "updatedAt")
      VALUES ('global', 1, CURRENT_TIMESTAMP)
    `;
    const beforeCount = await client.user.count();

    applyBootstrapMigration(fixture);

    const settings = await client.appSettings.findUnique({ where: { singletonKey: "global" } });
    const unchangedUser = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(settings?.allowRegistration).toBe(true);
    expect(settings?.bootstrapConsumedAt).toBeInstanceOf(Date);
    expect(await client.user.count()).toBe(beforeCount);
    expect(unchangedUser.password).toBe("legacy-hash");
    await client.$disconnect();
  }, 40_000);

  it("creates a closed consumed marker when a legacy user has no settings row", async () => {
    const fixture = await createPreBootstrapFixture();
    // eslint-disable-next-line no-restricted-syntax
    const client = new PrismaClient({ datasources: { db: { url: fixture.databaseUrl } } });
    await client.$executeRaw`
      INSERT INTO "User" ("id", "email", "password", "role")
      VALUES ('legacy-without-settings', 'legacy-without-settings@test.invalid', 'legacy-hash', 'ADMIN')
    `;

    applyBootstrapMigration(fixture);

    const settings = await client.appSettings.findUnique({ where: { singletonKey: "global" } });
    expect(settings?.allowRegistration).toBe(false);
    expect(settings?.bootstrapConsumedAt).toBeInstanceOf(Date);
    expect(await client.user.count()).toBe(1);
    await client.$disconnect();
  }, 40_000);
});
