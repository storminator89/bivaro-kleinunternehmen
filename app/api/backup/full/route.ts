import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import fs from 'fs';
import JSZip from 'jszip';
import { loadZipWithinLimits, ZipResourceLimitError } from '@/lib/zip-limits';
import { MAX_BACKUP_ZIP_ENTRIES, MAX_BACKUP_ZIP_ENTRY_BYTES, MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES } from '@/lib/resource-limits';
import { isSafeLegacyFileName, isSafeStoredFileName } from '@/lib/upload-path';
import { findOwnedUploadedFile } from '@/lib/upload-ownership';
import { auditSecurityEvent } from '@/lib/audit-log';

// GET: Export all user data as ZIP including files
export async function GET() {
  try {
    const userId = await requireUserId();

    // Fetch all user data including new models
    const [
      user,
      expenses,
      incomes,
      invoices,
      customers,
      settings,
      templates,
      recurringExpenses,
      reminders,
      cashBooks,
      cashTransactions,
      documentations,
      apiKeys
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, createdAt: true }
      }),
      prisma.expense.findMany({ where: { userId } }),
      prisma.income.findMany({ where: { userId } }),
      prisma.invoice.findMany({ where: { userId } }),
      prisma.customer.findMany({ where: { userId } }),
      prisma.settings.findUnique({ where: { userId } }),
      prisma.invoiceTemplate.findMany({ where: { userId } }),
      prisma.recurringExpense.findMany({ where: { userId } }),
      prisma.reminder.findMany({ where: { userId } }),
      prisma.cashBook.findMany({ where: { userId } }),
      prisma.cashTransaction.findMany({ where: { userId } }),
      prisma.documentation.findMany({ where: { userId } }),
      prisma.apiKey.findMany({ where: { userId }, select: { id: true, name: true, keyPrefix: true, scopes: true, isActive: true, expiresAt: true, createdAt: true } }),
    ]);



    // Create backup metadata
    const backup = {
      version: "2.0",
      type: "full",
      exportedAt: new Date().toISOString(),
      user: {
        email: user?.email,
        name: user?.name,
      },
      data: {
        expenses: expenses.map(e => ({
          ...e,
          userId: undefined,
        })),
        incomes: incomes.map(i => ({
          ...i,
          userId: undefined,
        })),
        invoices: invoices.map(inv => ({
          ...inv,
          userId: undefined,
        })),
        customers: customers.map(c => ({
          ...c,
          userId: undefined,
        })),
        settings: settings ? {
          ...settings,
          id: undefined,
          userId: undefined,
        } : null,
        templates: templates.map(t => ({
          ...t,
          userId: undefined,
        })),
        recurringExpenses: recurringExpenses.map(r => ({
          ...r,
          userId: undefined,
        })),
        reminders: reminders.map(r => ({
          ...r,
          userId: undefined,
        })),
        cashBooks: cashBooks.map(cb => ({
          ...cb,
          userId: undefined,
        })),
        cashTransactions: cashTransactions.map(ct => ({
          ...ct,
          userId: undefined,
        })),
        documentations: documentations.map(d => ({
          ...d,
          userId: undefined,
        })),
        apiKeys: apiKeys.map(ak => ({
          ...ak,
        })),
      },
      stats: {
        expenses: expenses.length,
        incomes: incomes.length,
        invoices: invoices.length,
        customers: customers.length,
        templates: templates.length,
        recurringExpenses: recurringExpenses.length,
        reminders: reminders.length,
        cashBooks: cashBooks.length,
        cashTransactions: cashTransactions.length,
        documentations: documentations.length,
        apiKeys: apiKeys.length,
      }
    };

    // Create ZIP archive
    const zip = new JSZip();
    const missingFiles: string[] = [];

    // Add JSON backup
    const metadata = JSON.stringify(backup, null, 2);
    let totalBytes = Buffer.byteLength(metadata);
    let fileCount = 1;
    if (totalBytes > MAX_BACKUP_ZIP_ENTRY_BYTES) throw new ZipResourceLimitError('Backup-Metadaten überschreiten die Wiederherstellungsgrenze');
    zip.file('backup.json', metadata);

    const addOwnedFile = async (kind: 'invoices' | 'receipts' | 'logos', storedName: string | null | undefined) => {
      if (!storedName || !(isSafeStoredFileName(storedName) || isSafeLegacyFileName(storedName))) {
        missingFiles.push(`${kind}/${storedName || '(leer)'}`);
        return;
      }
      if (zip.file(`${kind}/${storedName}`)) return;
      const filePath = await findOwnedUploadedFile(userId, storedName);
      if (!filePath) {
        missingFiles.push(`${kind}/${storedName}`);
        return;
      }
      try {
        const size = (await fs.promises.stat(filePath)).size;
        // Reserve room for the three directory entries JSZip adds automatically.
        if (size > MAX_BACKUP_ZIP_ENTRY_BYTES || totalBytes + size > MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES || fileCount + 4 > MAX_BACKUP_ZIP_ENTRIES) {
          throw new ZipResourceLimitError('Der Datenbestand überschreitet die Größenlimits des vollständigen Backups');
        }
        totalBytes += size;
        fileCount++;
        const fileContent = await fs.promises.readFile(filePath);
        zip.file(`${kind}/${storedName}`, fileContent);
      } catch (error) {
        if (error instanceof ZipResourceLimitError) throw error;
        missingFiles.push(`${kind}/${storedName}`);
      }
    };

    // Add invoice PDFs. A full archive must fail visibly if a referenced file
    // cannot be read; otherwise a later restore could only create a broken
    // invoice record.
    for (const invoice of invoices) {
      await addOwnedFile('invoices', invoice.storedFileName);
    }

    // Add expense receipts
    for (const expense of expenses) {
      if (expense.storedReceiptFileName) await addOwnedFile('receipts', expense.storedReceiptFileName);
    }

    // Add logo if exists
    if (settings?.logoUrl) {
      const logoMatch = settings.logoUrl.match(/(?:file=|\/uploads\/)(.+?)(?:$|&)/);
      if (logoMatch) {
        let logoFileName: string | null = null;
        try { logoFileName = decodeURIComponent(logoMatch[1]); } catch { /* reported below */ }
        await addOwnedFile('logos', logoFileName);
      } else {
        missingFiles.push('logos/(ungültige Referenz)');
      }
    }

    if (missingFiles.length > 0) {
      return NextResponse.json({
        error: 'Vollständiges Backup nicht möglich: referenzierte Dateien fehlen oder sind nicht zugreifbar.',
        missingFiles: missingFiles.slice(0, 100),
        missingCount: missingFiles.length,
      }, { status: 409 });
    }

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    // Never emit an archive that our own restore endpoint would reject.
    await loadZipWithinLimits(zipBuffer);

    await auditSecurityEvent(userId, {
      event: 'FULL_BACKUP_EXPORT',
      outcome: 'success',
      severity: 'info',
      metadata: {
        backupType: 'full',
        expensesCount: expenses.length,
        incomesCount: incomes.length,
        invoicesCount: invoices.length,
        customersCount: customers.length,
      },
    });

    const filename = `bivaro-full-backup-${new Date().toISOString().split('T')[0]}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof ZipResourceLimitError) return NextResponse.json({ error: error.message }, { status: 413 });
    console.error('Full backup error:', error);
    return NextResponse.json({ error: 'Vollständiges Backup fehlgeschlagen' }, { status: 500 });
  }
}
