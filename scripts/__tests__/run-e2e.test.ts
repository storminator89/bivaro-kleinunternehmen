import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import path from 'node:path';

const directories: string[] = [];
const processes: ChildProcess[] = [];

afterEach(() => {
  for (const child of processes.splice(0)) {
    if (child.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Process group already exited. */ }
    } else if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
  for (const directory of directories.splice(0)) {
    const recordPath = path.join(directory, 'record.json');
    if (existsSync(recordPath)) {
      const record = JSON.parse(readFileSync(recordPath, 'utf8'));
      rmSync(record.directory, { recursive: true, force: true });
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(cli: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-e2e-runner-test-'));
  directories.push(directory);
  const cliDirectory = path.join(directory, 'node_modules/@playwright/test');
  mkdirSync(cliDirectory, { recursive: true });
  writeFileSync(path.join(cliDirectory, 'cli.js'), cli);
  const inheritedDatabase = path.join(directory, 'inherited.db');
  writeFileSync(inheritedDatabase, 'keep this database');
  return { directory, inheritedDatabase };
}

function start(runner: string, directory: string, inheritedDatabase: string, args: string[] = []) {
  const child = spawn(process.execPath, [runner, ...args], {
    cwd: directory,
    detached: process.platform !== 'win32',
    env: { ...process.env, DATABASE_URL: `file:${inheritedDatabase}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(child);
  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, finished };
}

const recordFixture = (fixtureEnvironment: string) => `
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.${fixtureEnvironment};
fs.writeFileSync('record.json', JSON.stringify({ directory, databaseUrl: process.env.DATABASE_URL, args: process.argv.slice(2) }));
fs.writeFileSync(path.join(directory, 'test.db'), 'fake fixture database');
`;

describe.each([
  { runner: 'scripts/run-e2e.mjs', fixtureEnvironment: 'BIVARO_E2E_TEST_DIR', expectedArgs: ['test', '--grep', 'name with spaces', '--workers=1'] },
  { runner: 'scripts/run-security-e2e.mjs', fixtureEnvironment: 'BIVARO_SECURITY_TEST_DIR', expectedArgs: ['test', '--config=playwright.security.config.ts'] },
])('$runner process lifecycle', ({ runner, fixtureEnvironment, expectedArgs }) => {
  it('preserves CLI dispatch and exit status while isolating and cleaning its fixture', async () => {
    const { directory, inheritedDatabase } = fixture(recordFixture(fixtureEnvironment) + 'process.exit(7);');
    const { finished } = start(path.resolve(runner), directory, inheritedDatabase, ['--grep', 'name with spaces', '--workers=1']);
    expect(await finished).toEqual({ code: 7, signal: null });
    const record = JSON.parse(readFileSync(path.join(directory, 'record.json'), 'utf8'));
    expect(record.args).toEqual(expectedArgs);
    expect(record.databaseUrl).toBe(`file:${path.join(record.directory, 'test.db')}`);
    expect(existsSync(record.directory)).toBe(false);
    expect(readFileSync(inheritedDatabase, 'utf8')).toBe('keep this database');
  });

  it.runIf(process.platform !== 'win32').each(['SIGINT', 'SIGTERM'] as const)(
    'forwards %s and waits for child shutdown before removing the fixture',
    async (signal) => {
      const { directory, inheritedDatabase } = fixture(recordFixture(fixtureEnvironment) + `
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  setTimeout(() => {
    fs.writeFileSync(path.join(directory, 'shutdown-complete'), signal);
    fs.writeFileSync('shutdown.txt', signal);
    process.exit(0);
  }, 25);
});
setInterval(() => {}, 1000);
fs.writeFileSync('ready', 'yes');
`);
      const { child, finished } = start(path.resolve(runner), directory, inheritedDatabase);
      await vi.waitFor(() => expect(existsSync(path.join(directory, 'ready'))).toBe(true));
      const record = JSON.parse(readFileSync(path.join(directory, 'record.json'), 'utf8'));
      child.kill(signal);
      expect(await finished).toEqual({ code: 128 + constants.signals[signal], signal: null });
      expect(readFileSync(path.join(directory, 'shutdown.txt'), 'utf8')).toBe(signal);
      expect(existsSync(record.directory)).toBe(false);
      expect(readFileSync(inheritedDatabase, 'utf8')).toBe('keep this database');
    },
  );
});
