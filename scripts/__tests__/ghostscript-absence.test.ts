import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve('scripts/assert-no-ghostscript.sh');
const clean = 'nodejs installed\nlibc6:amd64 installed\n';
// Only shell plumbing and synthetic command stand-ins run. No gs, real package
// query, installer, JVM, compiler, renderer or browser is executed.
function inspect(records = clean, options: { binary?: boolean; queryStatus?: number; missingQuery?: boolean; missingAwk?: boolean } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-no-gs-'));
  try {
    const bin = path.join(directory, 'bin'); mkdirSync(bin);
    if (!options.missingAwk) symlinkSync('/usr/bin/awk', path.join(bin, 'awk'));
    const executable = (name: string, contents: string) => {
      const file = path.join(bin, name); writeFileSync(file, `#!/bin/sh\n${contents}\n`); chmodSync(file, 0o755);
    };
    if (!options.missingQuery) executable('dpkg-query', [
      'test "$#" = 2 && test "$1" = -W || exit 91',
      "test \"$2\" = '-f=${binary:Package} ${db:Status-Status}\\n' || exit 92",
      'printf \'%s\' "$BIVARO_PACKAGE_RECORDS"',
      'exit "$BIVARO_QUERY_STATUS"',
    ].join('\n'));
    const marker = path.join(directory, 'unexpected-gs-execution');
    if (options.binary) executable('gs', 'printf called > "$BIVARO_GS_MARKER"; exit 99');
    const result = spawnSync('/bin/sh', [script], {
      encoding: 'utf8', timeout: 5_000,
      env: { NODE_ENV: 'test', PATH: bin, BIVARO_PACKAGE_RECORDS: records, BIVARO_QUERY_STATUS: String(options.queryStatus ?? 0), BIVARO_GS_MARKER: marker },
    });
    expect(result.error).toBeUndefined();
    expect(() => readFileSync(marker)).toThrow();
    return result;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('read-only actual-runtime Ghostscript absence guard', () => {
  it('accepts a coherent inventory and emits only a closed positive receipt', () => {
    const result = inspect();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ event: 'ghostscript-absence', executable: 'absent', installedPackages: 'absent' });
  });
  it('rejects an available executable without ever invoking it', () => {
    const result = inspect(clean, { binary: true });
    expect(result.status).toBe(1); expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Ghostscript absence check failed: executable present.\n');
  });
  for (const name of ['ghostscript', 'ghostscript:amd64', 'ghostscript-x', 'ghostscript-doc:arm64', 'libgs', 'libgs:arm64', 'libgs-common', 'libgs-dev', 'libgs9', 'libgs10:amd64', 'libgs10-common', 'libgs10t64:arm64']) {
    it(`rejects interpreter package ${name}`, () => {
      const result = inspect(clean + `${name} installed\n`);
      expect(result.status).toBe(1); expect(result.stdout).toBe('');
    });
  }
  for (const status of ['half-installed', 'unpacked', 'half-configured', 'triggers-awaited', 'triggers-pending']) {
    it(`rejects remaining interpreter payload in state ${status}`, () => {
      expect(inspect(clean + `libgs10:amd64 ${status}\n`).status).toBe(1);
    });
  }
  for (const name of ['libgsf-1-114', 'libgsf-1-common', 'libgssapi-krb5-2:amd64', 'libgssrpc4', 'libgsasl18', 'libgstreamer1.0-0:arm64']) {
    it(`does not mistake unrelated ${name} for Ghostscript`, () => {
      expect(inspect(clean + `${name} installed\n`).status).toBe(0);
    });
  }
  it('does not confuse removed-package metadata with installed interpreter payload', () => {
    expect(inspect(clean + 'ghostscript config-files\nlibgs10:amd64 not-installed\n').status).toBe(0);
  });
  for (const records of ['', '\n', 'ghostscript\n', 'libgs10 installed unexpected\n', 'libgs10 unknown\n', 'libgs10: installed\n', '/private/path installed\n']) {
    it(`fails closed for invalid inventory ${JSON.stringify(records)}`, () => {
      const result = inspect(records); expect(result.status).toBe(1); expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain('/private/path');
    });
  }
  it('fails closed on a query error even with otherwise valid output', () => {
    expect(inspect(clean, { queryStatus: 73 }).status).toBe(1);
  });
  it('fails closed if the package-query command is unavailable', () => {
    const result = inspect(clean, { missingQuery: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('Ghostscript absence check failed: package inventory unavailable.\n');
  });
  it('fails closed without leaking paths if its inventory parser is unavailable', () => {
    const result = inspect(clean, { missingAwk: true });
    expect(result.status).toBe(1); expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Ghostscript absence check failed: interpreter package present or invalid inventory.\n');
  });
});
