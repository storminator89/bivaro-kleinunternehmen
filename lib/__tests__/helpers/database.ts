import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function createTestDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-test-'));
  const databasePath = path.join(directory, 'test.db');
  const url = `file:${databasePath}`;
  // Preserve Prisma's inferred query-event generic for the callers' $on listeners.
  const client = (() => {
    try {
      writeFileSync(databasePath, '');
      execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 30_000,
      });
      // Each integration suite owns an isolated connection and always disconnects it.
      // eslint-disable-next-line no-restricted-syntax
      return new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    } catch (error) {
      // The caller never receives a cleanup handle when setup fails.
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Test database setup and fixture cleanup failed.', { cause: error });
      }
      throw error;
    }
  })();
  return {
    client,
    url,
    async cleanup() {
      try {
        await client.$disconnect();
      } catch (error) {
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Test database disconnect and fixture cleanup failed.', { cause: error });
        }
        throw error;
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
