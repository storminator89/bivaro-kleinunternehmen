/** Authored migration preservation source ONLY. Never executed in the #54a preparation task. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { MANUAL_RECORD_UUID } from '@/lib/manual-financial-record-evidence';

it('adds only technical fields, retains exact legacy financial values/triggers, classifies only knowable sources and creates no financial posting', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bivaro-manual-upgrade-')), prismaDirectory = path.join(directory, 'prisma');
  const sourcePrisma = path.resolve('prisma'), migration = '20261025090000_add_manual_financial_record_lifecycle';
  const url = `file:${path.join(directory, 'legacy.db')}`;
  // eslint-disable-next-line no-restricted-syntax -- explicit new suite-owned temporary database, never application/production data.
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    mkdirSync(prismaDirectory); writeFileSync(url.slice(5), ''); cpSync(path.join(sourcePrisma, 'schema.prisma'), path.join(prismaDirectory, 'schema.prisma'));
    cpSync(path.join(sourcePrisma, 'migrations'), path.join(prismaDirectory, 'migrations'), { recursive: true, filter: source => !source.includes(path.join('migrations', migration)) });
    const deploy = () => execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(prismaDirectory, 'schema.prisma')], { cwd: directory, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 60_000 });
    deploy();
    await client.user.create({ data: { id: 'manual-upgrade-owner', email: 'manual-upgrade@test.invalid', password: 'unused' } });
    const at = new Date('2026-01-15T12:34:56.789Z');
    const invoice = await client.invoice.create({ data: { userId: 'manual-upgrade-owner', fileName: 'old.pdf', storedFileName: 'old.pdf', totalAmount: 15.25, status: 'PAID', issuanceState: 'ISSUED', paidAt: at, parsedData: {} } });
    // Raw writes deliberately use the PRE-upgrade column contract. A generated
    // current client must not select its new columns until migration deploys.
    await client.$executeRawUnsafe('INSERT INTO Income (id,description,amount,date,customerId,invoiceId,taxRelevant,userId) VALUES (?,?,?,?,?,?,?,?)', 701, 'Legacy journal receipt', 15.25, at.getTime(), null, invoice.id, true, 'manual-upgrade-owner');
    await client.$executeRawUnsafe('INSERT INTO Income (id,description,amount,date,customerId,invoiceId,taxRelevant,userId) VALUES (?,?,?,?,?,?,?,?)', 702, 'Legacy unreviewed fraction', 12.345, at.getTime(), null, null, false, 'manual-upgrade-owner');
    await client.$executeRawUnsafe('INSERT INTO Expense (id,description,amount,date,category,receiptUrl,taxRelevant,taxDeductiblePercentage,receiptFileName,storedReceiptFileName,depreciationYears,recurringExpenseId,scheduledDate,userId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 703, 'Old manual amount is already effective', 100.001, at.getTime(), 'Existing category', 'legacy://not-proof', true, 37.5, 'legacy.pdf', 'legacy.pdf', null, null, null, 'manual-upgrade-owner');
    await client.$executeRawUnsafe('INSERT INTO Expense (id,description,amount,date,category,taxRelevant,scheduledDate,userId) VALUES (?,?,?,?,?,?,?,?)', 704, 'Series FK already removed, schedule retained', 42, at.getTime(), 'Recurring', true, at.getTime(), 'manual-upgrade-owner');
    await client.paymentJournalEvent.create({ data: { userId: 'manual-upgrade-owner', invoiceId: invoice.id, incomeId: 701, amountCents: '1525', currency: 'EUR', paidAt: at, dateCertainty: 'ACTUAL', source: 'MANUAL', reference: 'Retain source evidence', idempotencyKey: 'preserved-upgrade-payment' } });
    const beforeIncome = await client.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM Income ORDER BY id');
    const beforeExpense = await client.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM Expense ORDER BY id');
    const beforeValues = await client.$queryRawUnsafe('SELECT id,quote(amount) AS exactAmount,quote(date) AS exactDate FROM Expense ORDER BY id');
    const beforeTriggers = await client.$queryRawUnsafe<{ name: string; sql: string }[]>("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name");
    const beforeJournal = await client.paymentJournalEvent.findMany(); await client.$disconnect();
    cpSync(path.join(sourcePrisma, 'migrations', migration), path.join(prismaDirectory, 'migrations', migration), { recursive: true }); deploy(); deploy();
    const oldColumns = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !['manualRecordId', 'manualRecordState', 'manualRecordOrigin', 'manualRecordRevision'].includes(key)));
    const afterIncome = await client.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM Income ORDER BY id'), afterExpense = await client.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM Expense ORDER BY id');
    expect(afterIncome.map(oldColumns)).toEqual(beforeIncome); expect(afterExpense.map(oldColumns)).toEqual(beforeExpense);
    expect(await client.$queryRawUnsafe('SELECT id,quote(amount) AS exactAmount,quote(date) AS exactDate FROM Expense ORDER BY id')).toEqual(beforeValues);
    for (const row of [...afterIncome, ...afterExpense]) { expect(MANUAL_RECORD_UUID.test(String(row.manualRecordId))).toBe(true); expect(row.manualRecordState).toBe('LEGACY_UNREVIEWED'); expect(row.manualRecordRevision).toBe(0); }
    expect(afterIncome.find(row => row.id === 701)?.manualRecordOrigin).toBe('PAYMENT_JOURNAL'); expect(afterIncome.find(row => row.id === 702)?.manualRecordOrigin).toBe('LEGACY_UNKNOWN'); expect(afterExpense.find(row => row.id === 704)?.manualRecordOrigin).toBe('RECURRING');
    expect(await client.paymentJournalEvent.findMany()).toEqual(beforeJournal); expect(await client.manualFinancialRecordEvent.count()).toBe(0);
    const afterTriggers = await client.$queryRawUnsafe<{ name: string; sql: string }[]>("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name");
    expect(afterTriggers.filter(trigger => beforeTriggers.some(before => before.name === trigger.name))).toEqual(beforeTriggers);
  } finally { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
}, 120_000);
