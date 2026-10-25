import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => {
  const client = { $disconnect: vi.fn<() => Promise<void>>() };
  return {
    client,
    PrismaClient: vi.fn(function () { return client; }),
    mkdtempSync: vi.fn<() => string>(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    execFileSync: vi.fn(),
  };
});

vi.mock('@prisma/client', () => ({ PrismaClient: state.PrismaClient }));
vi.mock('node:fs', () => ({
  mkdtempSync: state.mkdtempSync,
  writeFileSync: state.writeFileSync,
  rmSync: state.rmSync,
}));
vi.mock('node:child_process', () => ({ execFileSync: state.execFileSync }));

import { createTestDatabase } from './helpers/database';

const directory = path.join(tmpdir(), 'bivaro-test-owned-fixture');
const databasePath = path.join(directory, 'test.db');
const removalOptions = { recursive: true, force: true };

beforeEach(() => {
  vi.resetAllMocks();
  state.mkdtempSync.mockReturnValue(directory);
  state.PrismaClient.mockImplementation(function () { return state.client; });
  state.client.$disconnect.mockResolvedValue(undefined);
});

describe('isolated test database fixture lifecycle', () => {
  it('migrates the explicit owned database and removes it after disconnecting', async () => {
    const database = createTestDatabase();
    expect(state.mkdtempSync).toHaveBeenCalledExactlyOnceWith(path.join(tmpdir(), 'bivaro-test-'));
    expect(state.writeFileSync).toHaveBeenCalledExactlyOnceWith(databasePath, '');
    expect(state.execFileSync).toHaveBeenCalledExactlyOnceWith(
      process.execPath,
      [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      { env: { ...process.env, DATABASE_URL: `file:${databasePath}` }, stdio: 'pipe', timeout: 30_000 },
    );
    expect(state.PrismaClient).toHaveBeenCalledExactlyOnceWith({
      datasources: { db: { url: `file:${databasePath}` } },
      log: [{ emit: 'event', level: 'query' }],
    });
    expect(database).toMatchObject({ client: state.client, url: `file:${databasePath}` });
    expect(state.rmSync).not.toHaveBeenCalled();
    await database.cleanup();
    expect(state.client.$disconnect).toHaveBeenCalledExactlyOnceWith();
    expect(state.rmSync).toHaveBeenCalledExactlyOnceWith(directory, removalOptions);
    expect(state.client.$disconnect.mock.invocationCallOrder[0]).toBeLessThan(state.rmSync.mock.invocationCallOrder[0]);
  });

  it('does not remove an unowned directory when temporary-directory creation fails', () => {
    const error = new Error('synthetic temporary-directory failure');
    state.mkdtempSync.mockImplementationOnce(() => { throw error; });
    expect(createTestDatabase).toThrow(error);
    expect(state.writeFileSync).not.toHaveBeenCalled();
    expect(state.execFileSync).not.toHaveBeenCalled();
    expect(state.PrismaClient).not.toHaveBeenCalled();
    expect(state.rmSync).not.toHaveBeenCalled();
  });

  it('waits for disconnect to finish before removing the database directory', async () => {
    const database = createTestDatabase();
    let finishDisconnect!: () => void;
    state.client.$disconnect.mockImplementationOnce(() => new Promise<void>(resolve => { finishDisconnect = resolve; }));
    const cleanup = database.cleanup();
    expect(state.client.$disconnect).toHaveBeenCalledExactlyOnceWith();
    expect(state.rmSync).not.toHaveBeenCalled();
    finishDisconnect();
    await cleanup;
    expect(state.rmSync).toHaveBeenCalledExactlyOnceWith(directory, removalOptions);
  });

  it.each(['write', 'migration', 'client'] as const)('removes its fixture on %s setup failure without replacing the primary error', stage => {
    const error = new Error(`synthetic ${stage} failure`);
    const fail = () => { throw error; };
    if (stage === 'write') state.writeFileSync.mockImplementationOnce(fail);
    else if (stage === 'migration') state.execFileSync.mockImplementationOnce(fail);
    else state.PrismaClient.mockImplementationOnce(fail);
    let thrown: unknown;
    try { createTestDatabase(); } catch (caught) { thrown = caught; }
    expect(thrown).toBe(error);
    expect(state.rmSync).toHaveBeenCalledExactlyOnceWith(directory, removalOptions);
    expect(state.client.$disconnect).not.toHaveBeenCalled();
    if (stage === 'write') expect(state.execFileSync).not.toHaveBeenCalled();
    if (stage !== 'client') expect(state.PrismaClient).not.toHaveBeenCalled();
  });

  it('retains the primary setup error and secondary removal error when both fail', () => {
    const primary = new Error('synthetic migration failure');
    const secondary = new Error('synthetic removal failure');
    state.execFileSync.mockImplementationOnce(() => { throw primary; });
    state.rmSync.mockImplementationOnce(() => { throw secondary; });
    let thrown: unknown;
    try { createTestDatabase(); } catch (caught) { thrown = caught; }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown).toMatchObject({ cause: primary, errors: [primary, secondary] });
    expect(state.rmSync).toHaveBeenCalledExactlyOnceWith(directory, removalOptions);
  });

  it('removes its fixture even when disconnect fails and preserves that failure', async () => {
    const database = createTestDatabase();
    const error = new Error('synthetic disconnect failure');
    state.client.$disconnect.mockRejectedValueOnce(error);
    await expect(database.cleanup()).rejects.toBe(error);
    expect(state.rmSync).toHaveBeenCalledExactlyOnceWith(directory, removalOptions);
  });

  it('reports removal failure after a successful disconnect', async () => {
    const database = createTestDatabase();
    const error = new Error('synthetic removal failure');
    state.rmSync.mockImplementationOnce(() => { throw error; });
    await expect(database.cleanup()).rejects.toBe(error);
    expect(state.client.$disconnect).toHaveBeenCalledExactlyOnceWith();
    expect(state.rmSync).toHaveBeenCalledExactlyOnceWith(directory, removalOptions);
  });

  it('retains both disconnect and removal errors in primary-first order', async () => {
    const database = createTestDatabase();
    const primary = new Error('synthetic disconnect failure');
    const secondary = new Error('synthetic removal failure');
    state.client.$disconnect.mockRejectedValueOnce(primary);
    state.rmSync.mockImplementationOnce(() => { throw secondary; });
    const thrown = await database.cleanup().catch(error => error);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown).toMatchObject({ cause: primary, errors: [primary, secondary] });
    expect(state.rmSync).toHaveBeenCalledExactlyOnceWith(directory, removalOptions);
  });
});
