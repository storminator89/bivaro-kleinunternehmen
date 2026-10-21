import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

describe('annual context additive migration', () => {
  it('preserves old settings DTO data, full historical invoice and original bytes without inventing annual declarations', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-annual-upgrade-'));
    const prismaDirectory = path.join(directory, 'prisma');
    const migration = '20261021070000_add_annual_business_context';
    const sourcePrisma = path.resolve('prisma');
    const url = `file:${path.join(directory, 'legacy.db')}`;
    // eslint-disable-next-line no-restricted-syntax -- explicit isolated pre-migration database.
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      mkdirSync(prismaDirectory); writeFileSync(url.slice('file:'.length), '');
      cpSync(path.join(sourcePrisma, 'schema.prisma'), path.join(prismaDirectory, 'schema.prisma'));
      cpSync(path.join(sourcePrisma, 'migrations'), path.join(prismaDirectory, 'migrations'), { recursive: true, filter: source => !source.includes(path.join('migrations', migration)) });
      const deploy = () => execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(prismaDirectory, 'schema.prisma')], { cwd: directory, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 60_000 });
      deploy();
      await client.user.create({ data: { id: 'legacy-annual', email: 'legacy-annual@test.invalid', password: 'unused' } });
      const settings = await client.settings.create({ data: { userId: 'legacy-annual', companyName: 'Original minimal company', fiscalTaxRegime: 'SMALL_BUSINESS', fiscalEffectiveFrom: '2025-01-01', fiscalConfirmedAt: new Date('2025-01-02T00:00:00.000Z') } });
      const originalDirectory = path.join(directory, 'data', 'uploads', 'legacy-annual'); mkdirSync(originalDirectory, { recursive: true });
      const originalPath = path.join(originalDirectory, 'legacy-original.pdf');
      const bytes = Buffer.from('%PDF-1.4\n% synthetic original unchanged byte for byte\n%%EOF\n'); writeFileSync(originalPath, bytes);
      const invoice = await client.invoice.create({ data: { userId: 'legacy-annual', fileName: 'legacy-original.pdf', storedFileName: 'legacy-original.pdf', totalAmount: 987.65, invoiceNumber: '2025-1', status: 'SENT', issuanceState: 'ISSUED', parsedData: { taxMode: 'small-business', rawXML: '<untouched/>' } } });
      await client.$disconnect();
      cpSync(path.join(sourcePrisma, 'migrations', migration), path.join(prismaDirectory, 'migrations', migration), { recursive: true });
      deploy(); deploy();
      expect(await client.settings.findUniqueOrThrow({ where: { userId: 'legacy-annual' } })).toEqual(settings);
      expect(await client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toEqual(invoice);
      expect(readFileSync(originalPath)).toEqual(bytes);
      expect(await client.annualBusinessContextRevision.findMany()).toEqual([]);
    } finally { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
  }, 120_000);
});
