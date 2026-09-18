import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function createTestDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-test-'));
  const databasePath = path.join(directory, 'test.db');
  writeFileSync(databasePath, '');
  const url = `file:${databasePath}`;
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 30_000,
  });
  // Each integration suite owns an isolated connection and always disconnects it.
  // eslint-disable-next-line no-restricted-syntax
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  return {
    client,
    async cleanup() { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }); },
  };
}
