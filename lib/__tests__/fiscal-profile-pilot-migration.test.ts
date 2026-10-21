import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { EMPTY_FISCAL_PROFILE } from '@/lib/fiscal-profile';

describe('additive pilot fiscal profile migration', () => {
  it('upgrades legacy settings as unconfirmed while preserving complete existing invoice rows and amounts', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-fiscal-profile-upgrade-'));
    const prismaDirectory = path.join(directory, 'prisma');
    const migration = '20261020213000_add_fiscal_profile';
    const sourcePrisma = path.resolve('prisma');
    const url = `file:${path.join(directory, 'legacy.db')}`;
    // eslint-disable-next-line no-restricted-syntax -- isolated upgrade fixture uses an explicit new temporary database.
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      mkdirSync(prismaDirectory);
      writeFileSync(url.slice('file:'.length), '');
      cpSync(path.join(sourcePrisma, 'schema.prisma'), path.join(prismaDirectory, 'schema.prisma'));
      cpSync(path.join(sourcePrisma, 'migrations'), path.join(prismaDirectory, 'migrations'), {
        recursive: true, filter: source => !source.includes(path.join('migrations', migration)),
      });
      const deploy = () => execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(prismaDirectory, 'schema.prisma')], {
        cwd: directory, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 60_000,
      });
      deploy();
      await client.user.create({ data: { id: 'legacy-fiscal', email: 'legacy-fiscal@test.invalid', password: 'unused' } });
      await client.$executeRaw`INSERT INTO "Settings" ("userId", "companyName", "taxNumber") VALUES ('legacy-fiscal', 'Kleinunternehmen', 'legacy-tax-number')`;
      const invoice = await client.invoice.create({ data: {
        userId: 'legacy-fiscal', fileName: 'legacy-original.pdf', storedFileName: 'legacy-original.pdf',
        totalAmount: 987.65, invoiceNumber: '2025-1', status: 'PAID', issuanceState: 'ISSUED',
        parsedData: { taxMode: 'small-business', rawXML: '<untouched/>' },
      } });
      await client.$disconnect();
      cpSync(path.join(sourcePrisma, 'migrations', migration), path.join(prismaDirectory, 'migrations', migration), { recursive: true });
      deploy();
      deploy();
      expect(await client.settings.findUniqueOrThrow({ where: { userId: 'legacy-fiscal' } })).toMatchObject({
        companyName: 'Kleinunternehmen', taxNumber: 'legacy-tax-number', ...EMPTY_FISCAL_PROFILE,
      });
      expect(await client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toEqual(invoice);
    } finally {
      await client.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
