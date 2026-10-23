import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

it('adds adjustment capability without rewriting any original finance row or original immutability trigger', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-adjustment-upgrade-'));
  const prismaDirectory = path.join(directory, 'prisma');
  const migration = '20261021150000_add_payment_adjustments';
  const allocationMigration = '20261023010000_add_bank_payment_allocations';
  const source = path.resolve('prisma');
  const url = `file:${path.join(directory, 'synthetic.db')}`;
  // eslint-disable-next-line no-restricted-syntax -- explicit fresh temporary migration fixture only.
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    mkdirSync(prismaDirectory); writeFileSync(url.slice(5), '');
    cpSync(path.join(source, 'schema.prisma'), path.join(prismaDirectory, 'schema.prisma'));
    cpSync(path.join(source, 'migrations'), path.join(prismaDirectory, 'migrations'), {
      recursive: true, filter: filename => !filename.includes(path.join('migrations', migration)) && !filename.includes(path.join('migrations', allocationMigration)),
    });
    const deploy = () => execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(prismaDirectory, 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: url }, cwd: directory, stdio: 'pipe', timeout: 60_000,
    });
    deploy();
    await client.user.create({ data: { id: 'synthetic-upgrade', email: 'synthetic-upgrade@test.invalid', password: 'unused' } });
    const invoice = await client.invoice.create({ data: { userId: 'synthetic-upgrade', invoiceNumber: '2025-120', fileName: 'synthetic.pdf', storedFileName: 'synthetic.pdf', parsedData: { currency: 'EUR', taxMode: 'small-business' }, totalAmount: 120, status: 'PAID', issuanceState: 'ISSUED', paidAt: new Date('2025-06-15T12:13:14.123Z') } });
    const income = await client.income.create({ data: { userId: 'synthetic-upgrade', invoiceId: invoice.id, amount: 120, date: invoice.paidAt!, description: 'Synthetic immutable receipt' } });
    const root = await client.paymentJournalEvent.create({ data: { userId: 'synthetic-upgrade', invoiceId: invoice.id, incomeId: income.id, amountCents: '12000', currency: 'EUR', paidAt: invoice.paidAt, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Synthetic original', idempotencyKey: 'synthetic-original-key' } });
    const triggers = await client.$queryRawUnsafe(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='PaymentJournalEvent' ORDER BY name`);
    await client.$disconnect();
    cpSync(path.join(source, 'migrations', migration), path.join(prismaDirectory, 'migrations', migration), { recursive: true });
    cpSync(path.join(source, 'migrations', allocationMigration), path.join(prismaDirectory, 'migrations', allocationMigration), { recursive: true });
    deploy(); deploy();
    // The supported startup boundary must see no physical drift. In
    // particular, the composite command FK must be represented in Prisma.
    expect(execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', `--from-url=${url}`, `--to-schema-datamodel=${path.join(prismaDirectory, 'schema.prisma')}`, '--exit-code'], {
      env: { ...process.env, DATABASE_URL: url }, cwd: directory, encoding: 'utf8', stdio: 'pipe', timeout: 60_000,
    })).toContain('No difference detected');
    expect(await client.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toEqual(invoice);
    expect(await client.income.findUniqueOrThrow({ where: { id: income.id } })).toEqual(income);
    expect(await client.paymentJournalEvent.findUniqueOrThrow({ where: { id: root.id } })).toEqual(root);
    expect(await client.paymentAdjustment.count()).toBe(0); expect(await client.paymentOperation.count()).toBe(0);
    const after = await client.$queryRawUnsafe<{ name: string; sql: string }[]>(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='PaymentJournalEvent' ORDER BY name`);
    expect(after.filter(row => !['PaymentJournalEvent_operation_insert', 'PaymentJournalEvent_no_legacy_allocation_insert'].includes(row.name))).toEqual(triggers);
    await expect(client.paymentJournalEvent.update({ where: { id: root.id }, data: { reference: 'forbidden' } })).rejects.toThrow();
    await expect(client.paymentJournalEvent.delete({ where: { id: root.id } })).rejects.toThrow();
  } finally { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
}, 120_000);
