import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SQLITE_PREFIX = 'file:';

function runtimeRoot() {
  return process.env.APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function schemaFile() {
  return path.resolve(process.env.PRISMA_SCHEMA || path.join(runtimeRoot(), 'prisma', 'schema.prisma'));
}

function ownerText(stat) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown';
  const gid = typeof process.getgid === 'function' ? process.getgid() : 'unknown';
  return `effective UID=${uid} GID=${gid}; owner UID=${stat.uid} GID=${stat.gid}`;
}

function configurationError(message) {
  return new Error(`DATABASE_URL configuration error: ${message}`);
}

/**
 * Resolve the persistent SQLite file that Prisma resolves relative to the
 * schema directory. The configured URL itself is deliberately not changed.
 */
export function resolveDatabaseTarget({ databaseUrl = process.env.DATABASE_URL, schema = schemaFile() } = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw configurationError('DATABASE_URL is required.');
  }

  const separator = databaseUrl.indexOf(':');
  const providerCandidate = separator === -1 ? '' : databaseUrl.slice(0, separator);
  const provider = /^[A-Za-z][A-Za-z0-9+.-]*$/.test(providerCandidate) ? providerCandidate : 'unknown';
  if (provider !== 'file') {
    throw configurationError(`unsupported provider "${provider}"; this image supports only SQLite file: URLs.`);
  }

  const urlValue = databaseUrl.slice(SQLITE_PREFIX.length);
  const queryStart = urlValue.search(/[?#]/);
  const pathPart = queryStart === -1 ? urlValue : urlValue.slice(0, queryStart);

  if (queryStart !== -1) {
    throw configurationError('SQLite query parameters and fragments are unsupported; use a plain file:<absolute-path> URL.');
  }
  if (pathPart === ':memory:' || pathPart === '') {
    throw configurationError('an in-memory or empty SQLite target is not persistent and is not supported.');
  }
  if (urlValue.startsWith('//')) {
    throw configurationError('SQLite URL authorities are unsupported; use a plain file:/absolute/path URL.');
  }
  if (databaseUrl.includes('%')) {
    throw configurationError('percent-encoded SQLite paths are unsupported; use the literal absolute filesystem path.');
  }
  if (!pathPart.startsWith('/')) {
    throw configurationError('relative SQLite paths are unsupported; use an absolute file:/... URL so CLI and app share one target.');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DATABASE_URL configuration error:')) {
      throw error;
    }
    throw configurationError('the SQLite file path is not a valid encoded path.');
  }

  if (decodedPath.includes('\0')) {
    throw configurationError('the SQLite file path contains an invalid NUL byte.');
  }

  const schemaDirectory = path.dirname(path.resolve(schema));
  const absolutePath = path.resolve(schemaDirectory, decodedPath);
  return {
    provider: 'sqlite',
    configuredUrl: databaseUrl,
    path: absolutePath,
    schema: path.resolve(schema),
    parent: path.dirname(absolutePath),
  };
}

function accessError(target, action, error) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    stat = null;
  }

  const ownership = stat ? ` (${ownerText(stat)})` : '';
  return new Error(
    `database ${action} check failed for ${target}${ownership}: ${error.message}. ` +
      `Grant the container UID/GID access (for example chown <uid>:<gid> ${target} or adjust the mounted volume); do not delete the volume.`,
  );
}

/**
 * Check permissions and existence without creating, deleting, linking, or
 * rewriting a database file. Startup requires an already upgraded file;
 * upgrade mode permits a new file so migrate deploy can initialize it.
 */
export function verifyDatabaseTarget(target, { mode = 'startup' } = {}) {
  if (!['startup', 'upgrade'].includes(mode)) {
    throw new Error(`unknown database verification mode "${mode}".`);
  }

  let parentStat;
  try {
    parentStat = fs.statSync(target.parent);
  } catch (error) {
    throw accessError(target.parent, 'parent directory', error);
  }
  if (!parentStat.isDirectory()) {
    throw new Error(`database parent ${target.parent} is not a directory.`);
  }
  try {
    fs.accessSync(target.parent, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  } catch (error) {
    throw accessError(target.parent, 'parent directory permissions', error);
  }

  let databaseStat;
  try {
    databaseStat = fs.statSync(target.path);
  } catch (error) {
    if (error?.code === 'ENOENT' && mode === 'upgrade') {
      return { ...target, exists: false, owner: ownerText(parentStat) };
    }
    if (error?.code === 'ENOENT') {
      throw new Error(
        `database file ${target.path} does not exist. Run the explicit upgrade job before starting the app; no database file is created during startup.`,
      );
    }
    throw accessError(target.path, 'database', error);
  }

  if (!databaseStat.isFile()) {
    throw new Error(`database target ${target.path} is not a regular file; refusing to modify it.`);
  }
  try {
    fs.accessSync(target.path, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw accessError(target.path, 'database permissions', error);
  }

  return { ...target, exists: true, owner: ownerText(databaseStat) };
}

export function createTempDirectory(prefix = 'bivaro-runtime-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function databaseUrlForPath(filePath) {
  return `file:${path.resolve(filePath)}`;
}

function printVerification(result, mode) {
  const state = result.exists ? 'present' : 'absent (upgrade may initialize it)';
  console.log(`[database-runtime] mode=${mode} target=${result.path} ${state}`);
  console.log(`[database-runtime] ${result.owner}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex === -1 ? 'startup' : process.argv[modeIndex + 1];
  try {
    const target = resolveDatabaseTarget();
    printVerification(verifyDatabaseTarget(target, { mode }), mode);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
