import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * A rate limit is identified by a logical scope and value (for example
 * `login:email` or `login:ip`).  The value is hashed before it reaches the
 * database so email addresses and client addresses are not retained there.
 */
export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
  /** How long a caller is blocked after attempting request limit + 1. */
  blockMs?: number;
  /** How long unused rows may remain before the shared TTL cleanup removes them. */
  cleanupAfterMs?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

type HeaderSource = Headers | Record<string, unknown> | undefined;

interface RateLimitRow {
  count: number;
  windowStartedAt: string | Date;
  blockedUntil: string | Date | null;
}

const DEFAULT_BLOCK_MS = 30 * 60 * 1000;
const MIN_CLEANUP_MS = 60 * 60 * 1000;
const CLEANUP_CHECK_INTERVAL_MS = 60 * 1000;
let lastCleanupAt = 0;

function isRetryableDatabaseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1008", "P2028", "P2034"].includes(error.code);
  }
  return error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message);
}

async function withDatabaseRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * 2 ** attempt));
    }
  }
}

/** Return a stable, non-reversible database key for a logical limiter key. */
export function hashRateLimitKey(logicalKey: string): string {
  return crypto.createHash("sha256").update(logicalKey).digest("hex");
}

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return headers.get(name) || undefined;
  }

  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

/**
 * Get a client address only when the deployment explicitly trusts a proxy.
 * Forwarding headers are otherwise attacker-controlled and are deliberately
 * ignored.  A proxy must strip incoming forwarding headers before adding its
 * own values; this function cannot establish that property by itself.
 */
export function getTrustedClientIp(headers: HeaderSource): string {
  const trustProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");
  if (!trustProxy) return "untrusted-proxy";

  const realIp = readHeader(headers, "x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = readHeader(headers, "x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  return firstForwarded || "unknown-client";
}

async function pruneIfDue(now: Date, policy: RateLimitPolicy): Promise<void> {
  if (now.getTime() - lastCleanupAt < CLEANUP_CHECK_INTERVAL_MS) return;

  const cleanupAfterMs = Math.max(
    MIN_CLEANUP_MS,
    policy.cleanupAfterMs || 0,
    policy.windowMs * 2,
    (policy.blockMs || DEFAULT_BLOCK_MS) * 2,
  );
  const cutoff = new Date(now.getTime() - cleanupAfterMs).toISOString();

  await withDatabaseRetry(() =>
    prisma.$executeRaw(
      Prisma.sql`DELETE FROM "RateLimitBucket" WHERE "updatedAt" < ${cutoff}`,
    ),
  );
  lastCleanupAt = now.getTime();
}

/** Remove all expired limiter rows. Useful from a scheduled maintenance job. */
export async function pruneRateLimitBuckets(
  olderThanMs = 24 * 60 * 60 * 1000,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - Math.max(MIN_CLEANUP_MS, olderThanMs)).toISOString();
  const deleted = await withDatabaseRetry(() =>
    prisma.$executeRaw(
      Prisma.sql`DELETE FROM "RateLimitBucket" WHERE "updatedAt" < ${cutoff}`,
    ),
  );
  lastCleanupAt = now.getTime();
  return Number(deleted);
}

/** Reset one logical limiter key, usually after a successful authentication. */
export async function resetRateLimit(logicalKey: string): Promise<void> {
  const key = hashRateLimitKey(logicalKey);
  await withDatabaseRetry(() =>
    prisma.$executeRaw(Prisma.sql`DELETE FROM "RateLimitBucket" WHERE "key" = ${key}`),
  );
}

/**
 * Atomically consume one token in a SQLite-backed bucket.
 *
 * The upsert is a single SQLite write statement.  This matters for parallel
 * login/registration requests: a read-then-write map or Prisma upsert would
 * allow two workers to observe the same old count and both pass the limit.
 */
export async function consumeRateLimit(
  logicalKey: string,
  policy: RateLimitPolicy,
  now = new Date(),
): Promise<RateLimitDecision> {
  if (!Number.isInteger(policy.limit) || policy.limit < 1) {
    throw new Error("Rate-limit limit must be a positive integer");
  }
  if (!Number.isFinite(policy.windowMs) || policy.windowMs <= 0) {
    throw new Error("Rate-limit window must be positive");
  }

  await pruneIfDue(now, policy);

  const key = hashRateLimitKey(logicalKey);
  const nowIso = now.toISOString();
  const windowSeconds = Math.max(1, Math.ceil(policy.windowMs / 1000));
  const blockMs = Math.max(1, policy.blockMs ?? DEFAULT_BLOCK_MS);
  const blockUntilIso = new Date(now.getTime() + blockMs).toISOString();

  const rows = await withDatabaseRetry(() => prisma.$queryRaw<RateLimitRow[]>(Prisma.sql`
    INSERT INTO "RateLimitBucket"
      ("key", "count", "windowStartedAt", "blockedUntil", "updatedAt")
    VALUES (${key}, 1, ${nowIso}, NULL, ${nowIso})
    ON CONFLICT("key") DO UPDATE SET
      "count" = CASE
        WHEN "blockedUntil" IS NOT NULL AND "blockedUntil" > ${nowIso}
          THEN "count"
        WHEN ("blockedUntil" IS NOT NULL AND "blockedUntil" <= ${nowIso})
          OR ((julianday(${nowIso}) - julianday("windowStartedAt")) * 86400 >= ${windowSeconds})
          THEN 1
        ELSE "count" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "blockedUntil" IS NOT NULL AND "blockedUntil" > ${nowIso}
          THEN "windowStartedAt"
        WHEN ("blockedUntil" IS NOT NULL AND "blockedUntil" <= ${nowIso})
          OR ((julianday(${nowIso}) - julianday("windowStartedAt")) * 86400 >= ${windowSeconds})
          THEN ${nowIso}
        ELSE "windowStartedAt"
      END,
      "blockedUntil" = CASE
        WHEN "blockedUntil" IS NOT NULL AND "blockedUntil" > ${nowIso}
          THEN "blockedUntil"
        WHEN ("blockedUntil" IS NOT NULL AND "blockedUntil" <= ${nowIso})
          OR ((julianday(${nowIso}) - julianday("windowStartedAt")) * 86400 >= ${windowSeconds})
          THEN NULL
        WHEN "count" >= ${policy.limit}
          THEN ${blockUntilIso}
        ELSE NULL
      END,
      "updatedAt" = ${nowIso}
    RETURNING "count", "windowStartedAt", "blockedUntil"
  `));

  const row = rows[0];
  if (!row) throw new Error("Rate-limit bucket update returned no row");

  const count = Number(row.count);
  const blockedUntil = row.blockedUntil ? new Date(row.blockedUntil).getTime() : null;
  const isBlocked = blockedUntil !== null && blockedUntil > now.getTime();
  const windowStartedAt = new Date(row.windowStartedAt).getTime();
  const windowRetryAt = windowStartedAt + policy.windowMs;
  const retryAt = isBlocked ? blockedUntil : windowRetryAt;

  return {
    allowed: !isBlocked,
    remaining: isBlocked ? 0 : Math.max(0, policy.limit - count),
    retryAfterSeconds: Math.max(0, Math.ceil((retryAt - now.getTime()) / 1000)),
  };
}
