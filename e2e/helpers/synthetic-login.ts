import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { e2eDatabasePath } from '../../scripts/e2e-fixture.mjs';

/** Isolate new synthetic accounts from the full suite's shared fallback-IP budget.
 * The real login and unchanged production policies still run. Never use this
 * against an application database or in the separate rate-limit security suite.
 */
export async function isolateSyntheticLoginIpBudget() {
  const fixtureUrl = `file:${e2eDatabasePath()}`;
  if (process.env.DATABASE_URL !== fixtureUrl) {
    throw new Error('Synthetic login isolation requires the exact fresh E2E database.');
  }
  const key = createHash('sha256').update('login:ip:untrusted-proxy').digest('hex');
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}
