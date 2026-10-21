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
      recursive: true, filter: source => !source.includes(path.join('migrations', migration)) && !source.includes(path.join('migrations', '20261021043000_add_partial_payments')),
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

it('plural-index migration preserves singleton history and immutable/link/cent triggers', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-partial-upgrade-'));
  const prismaDirectory = path.join(directory, 'prisma');
  const migration = '20261021043000_add_partial_payments';
  const sourcePrisma = path.resolve('prisma');
  const url = `file:${path.join(directory, 'singleton.db')}`;
  // eslint-disable-next-line no-restricted-syntax -- fresh explicit suite-owned migration fixture.
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    mkdirSync(prismaDirectory); writeFileSync(url.slice(5), '');
    cpSync(path.join(sourcePrisma, 'schema.prisma'), path.join(prismaDirectory, 'schema.prisma'));
    cpSync(path.join(sourcePrisma, 'migrations'), path.join(prismaDirectory, 'migrations'), {
      recursive: true, filter: source => !source.includes(path.join('migrations', migration)),
    });
    const deploy = () => execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(prismaDirectory, 'schema.prisma')], {
      cwd: directory, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 60_000,
    });
    deploy();
    await client.user.createMany({ data: ['partial-upgrade', 'partial-foreign'].map(id => ({ id, email: `${id}@test.invalid`, password: 'fixture' })) });
    const source = await client.invoice.create({ data: { userId: 'partial-upgrade', fileName: 'old.pdf', storedFileName: 'old.pdf', parsedData: {}, totalAmount: 120, status: 'PAID', issuanceState: 'ISSUED', paidAt: new Date('2025-12-31') } });
    const income = await client.income.create({ data: { userId: 'partial-upgrade', invoiceId: source.id, amount: 120, date: source.paidAt!, description: 'Existing singleton' } });
    const event = await client.paymentJournalEvent.create({ data: { userId: 'partial-upgrade', invoiceId: source.id, incomeId: income.id, amountCents: '12000', currency: 'EUR', paidAt: source.paidAt, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Original evidence', idempotencyKey: 'singleton-key' } });
    const triggers = await client.$queryRawUnsafe('SELECT name, sql FROM sqlite_master WHERE type = \'trigger\' ORDER BY name');
    await client.$disconnect();
    cpSync(path.join(sourcePrisma, 'migrations', migration), path.join(prismaDirectory, 'migrations', migration), { recursive: true });
    deploy(); deploy();
    expect(await client.invoice.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    expect(await client.income.findUniqueOrThrow({ where: { id: income.id } })).toEqual(income);
    expect(await client.paymentJournalEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(event);
    expect(await client.$queryRawUnsafe('SELECT name, sql FROM sqlite_master WHERE type = \'trigger\' ORDER BY name')).toEqual(triggers);
    const partial = await client.invoice.create({ data: { userId: 'partial-upgrade', fileName: 'new.pdf', storedFileName: 'new.pdf', parsedData: {}, totalAmount: 120, status: 'SENT', issuanceState: 'ISSUED' } });
    for (const [index, amount] of [40, 80].entries()) {
      const projection = await client.income.create({ data: { userId: 'partial-upgrade', invoiceId: partial.id, amount, date: new Date(`2026-01-0${index + 1}`), description: 'Allocation' } });
      await client.paymentJournalEvent.create({ data: { userId: 'partial-upgrade', invoiceId: partial.id, incomeId: projection.id, amountCents: String(amount * 100), currency: 'EUR', paidAt: projection.date, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Actual evidence', idempotencyKey: `allocation-${index}` } });
    }
    expect(await client.paymentJournalEvent.count({ where: { invoiceId: partial.id } })).toBe(2);
    expect(await client.income.count({ where: { invoiceId: partial.id } })).toBe(2);
    await expect(client.paymentJournalEvent.update({ where: { id: event.id }, data: { reference: 'overwrite' } })).rejects.toThrow();
    await expect(client.paymentJournalEvent.delete({ where: { id: event.id } })).rejects.toThrow();
    await expect(client.paymentJournalEvent.create({ data: { userId: 'partial-foreign', invoiceId: partial.id, amountCents: '1', currency: 'EUR', paidAt: null, dateCertainty: 'UNKNOWN', source: 'LEGACY_IMPORT', reference: 'Foreign', idempotencyKey: 'foreign' } })).rejects.toThrow();
  } finally { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
}, 120_000);
