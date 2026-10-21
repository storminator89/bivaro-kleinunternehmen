import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

it('additive journal migration preserves complete legacy finance rows and never invents historical payments', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-payment-upgrade-'));
  const prismaDirectory = path.join(directory, 'prisma');
  const migration = '20261020230000_add_payment_journal';
  const sourcePrisma = path.resolve('prisma');
  const url = `file:${path.join(directory, 'legacy.db')}`;
  // eslint-disable-next-line no-restricted-syntax -- fresh explicit temporary migration fixture, never application data.
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    mkdirSync(prismaDirectory); writeFileSync(url.slice('file:'.length), '');
    cpSync(path.join(sourcePrisma, 'schema.prisma'), path.join(prismaDirectory, 'schema.prisma'));
    cpSync(path.join(sourcePrisma, 'migrations'), path.join(prismaDirectory, 'migrations'), {
      recursive: true, filter: source => !source.includes(path.join('migrations', migration)),
    });
    const deploy = () => execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(prismaDirectory, 'schema.prisma')], {
      cwd: directory, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 60_000,
    });
    deploy();
    await client.user.create({ data: { id: 'legacy-journal', email: 'legacy-journal@test.invalid', password: 'unused' } });
    const unknown = await client.invoice.create({ data: { userId: 'legacy-journal', fileName: 'old.pdf', storedFileName: 'old.pdf', totalAmount: 987.65,
      invoiceNumber: '2025-1', status: 'PAID', issuanceState: 'ISSUED', paidAt: null, parsedData: { rawXML: '<untouched/>' } } });
    const dated = await client.invoice.create({ data: { userId: 'legacy-journal', fileName: 'dated.pdf', storedFileName: 'dated.pdf', totalAmount: 12.34,
      invoiceNumber: '2025-2', status: 'PAID', issuanceState: 'ISSUED', paidAt: new Date('2025-10-01T12:00:00Z'), parsedData: {} } });
    const income = await client.income.create({ data: { userId: 'legacy-journal', invoiceId: dated.id, amount: 12.34, date: dated.paidAt!, description: 'Preserve old financial booking' } });
    await client.$disconnect();
    cpSync(path.join(sourcePrisma, 'migrations', migration), path.join(prismaDirectory, 'migrations', migration), { recursive: true });
    deploy(); deploy();
    expect(await client.invoice.findUniqueOrThrow({ where: { id: unknown.id } })).toEqual(unknown);
    expect(await client.invoice.findUniqueOrThrow({ where: { id: dated.id } })).toEqual(dated);
    expect(await client.income.findUniqueOrThrow({ where: { id: income.id } })).toEqual(income);
    expect(await client.paymentJournalEvent.count()).toBe(0);
  } finally { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
}, 120_000);
