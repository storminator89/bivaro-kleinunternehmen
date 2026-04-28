import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import fs from 'fs';
import JSZip from 'jszip';
import { findUploadedFile } from '@/lib/upload-path';
import { auditSecurityEvent } from '@/lib/audit-log';

const prisma = new PrismaClient();

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

    // Add JSON backup
    zip.file('backup.json', JSON.stringify(backup, null, 2));

    // Add invoice PDFs
    for (const invoice of invoices) {
      if (invoice.storedFileName) {
        const filePath = findUploadedFile(invoice.storedFileName);
        if (filePath && fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath);
          zip.file(`invoices/${invoice.storedFileName}`, fileContent);
        }
      }
    }

    // Add expense receipts
    for (const expense of expenses) {
      if (expense.storedReceiptFileName) {
        const filePath = findUploadedFile(expense.storedReceiptFileName);
        if (filePath && fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath);
          zip.file(`receipts/${expense.storedReceiptFileName}`, fileContent);
        }
      }
    }

    // Add logo if exists
    if (settings?.logoUrl) {
      const logoMatch = settings.logoUrl.match(/(?:file=|\/uploads\/)(.+?)(?:$|&)/);
      if (logoMatch) {
        const logoFileName = logoMatch[1];
        const logoPath = findUploadedFile(logoFileName);
        if (logoPath && fs.existsSync(logoPath)) {
          const fileContent = fs.readFileSync(logoPath);
          zip.file(`logos/${logoFileName}`, fileContent);
        }
      }
    }

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
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
    console.error('Full backup error:', error);
    return NextResponse.json({ error: 'Vollständiges Backup fehlgeschlagen' }, { status: 500 });
  }
}
