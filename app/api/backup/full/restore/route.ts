import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { UPLOAD_BASE_DIR, ensureUploadDirExists } from '@/lib/upload-path';

const prisma = new PrismaClient();

// POST: Restore user data from ZIP backup including files
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();

    // Check for overwrite mode via query parameter
    const { searchParams } = new URL(request.url);
    const confirmOverwrite = searchParams.get('confirmOverwrite') === 'true';

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Parse ZIP file
    const zip = await JSZip.loadAsync(buffer);

    // Find and parse backup.json
    const backupFile = zip.file('backup.json');
    if (!backupFile) {
      return NextResponse.json({ error: 'Ungültiges Backup: backup.json fehlt' }, { status: 400 });
    }

    const backupContent = await backupFile.async('string');
    const backup = JSON.parse(backupContent);

    if (!backup.version || !backup.data) {
      return NextResponse.json({ error: 'Ungültiges Backup-Format' }, { status: 400 });
    }

    // Delete all existing data if overwrite mode is enabled
    if (confirmOverwrite) {
      await prisma.$transaction(async (tx) => {
        // Delete tables with foreign keys first
        await tx.cashTransaction.deleteMany({ where: { userId } });
        await tx.cashBook.deleteMany({ where: { userId } });
        await tx.reminder.deleteMany({ where: { userId } });
        await tx.documentation.deleteMany({ where: { userId } });
        await tx.recurringExpense.deleteMany({ where: { userId } });
        await tx.apiKey.deleteMany({ where: { userId } });
        await tx.apiLog.deleteMany({ where: { userId } });
        await tx.auditLog.deleteMany({ where: { userId } });
        await tx.invoiceTemplate.deleteMany({ where: { userId } });
        await tx.income.deleteMany({ where: { userId } });
        await tx.expense.deleteMany({ where: { userId } });
        await tx.invoice.deleteMany({ where: { userId } });
        await tx.customer.deleteMany({ where: { userId } });
        await tx.settings.deleteMany({ where: { userId } });
      });
    }

    const {
      expenses, incomes, invoices, customers, settings, templates,
      recurringExpenses, reminders, cashBooks, cashTransactions, documentations
    } = backup.data;

    // Ensure upload directory exists - all files go to data/uploads (private)
    ensureUploadDirExists();

    // Track import results
    const results = {
      overwriteMode: confirmOverwrite,
      deleted: confirmOverwrite ? 'Alle bestehenden Daten wurden gelöscht' : undefined,
      customers: { imported: 0, skipped: 0 },
      expenses: { imported: 0, skipped: 0 },
      incomes: { imported: 0, skipped: 0 },
      invoices: { imported: 0, skipped: 0 },
      templates: { imported: 0, skipped: 0 },
      files: { imported: 0, skipped: 0 },
      settings: { imported: false },
      recurringExpenses: { imported: 0, skipped: 0 },
      reminders: { imported: 0, skipped: 0 },
      cashBooks: { imported: 0, skipped: 0 },
      cashTransactions: { imported: 0, skipped: 0 },
      documentations: { imported: 0, skipped: 0 },
    };

    // Create ID mapping for relations
    const customerIdMap = new Map<number, number>();
    const invoiceIdMap = new Map<number, number>();
    const cashBookIdMap = new Map<number, number>();

    // 1. Import customers first
    if (customers && Array.isArray(customers)) {
      for (const customer of customers) {
        try {
          const existing = await prisma.customer.findFirst({
            where: { userId, name: customer.name }
          });

          if (existing) {
            customerIdMap.set(customer.id, existing.id);
            results.customers.skipped++;
          } else {
            const newCustomer = await prisma.customer.create({
              data: {
                name: customer.name,
                contactPerson: customer.contactPerson || null,
                email: customer.email || null,
                phone: customer.phone || null,
                address: customer.address || null,
                zipCode: customer.zipCode || null,
                city: customer.city || null,
                taxNumber: customer.taxNumber || null,
                userId,
              }
            });
            customerIdMap.set(customer.id, newCustomer.id);
            results.customers.imported++;
          }
        } catch (e) {
          console.error('Customer import error:', e);
          results.customers.skipped++;
        }
      }
    }

    // 2. Extract and import invoice files, then create records
    if (invoices && Array.isArray(invoices)) {
      // First pass: import invoices
      for (const invoice of invoices) {
        try {
          // Check if invoice with same number exists
          if (invoice.invoiceNumber) {
            const existing = await prisma.invoice.findFirst({
              where: { userId, invoiceNumber: invoice.invoiceNumber }
            });

            if (existing) {
              invoiceIdMap.set(invoice.id, existing.id);
              results.invoices.skipped++;
              continue;
            }
          }

          // Extract invoice file if exists
          if (invoice.storedFileName) {
            const invoiceFile = zip.file(`invoices/${invoice.storedFileName}`);
            if (invoiceFile) {
              const fileBuffer = await invoiceFile.async('nodebuffer');
              const filePath = path.join(UPLOAD_BASE_DIR, invoice.storedFileName);
              if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, fileBuffer);
                results.files.imported++;
              } else {
                results.files.skipped++;
              }
            }
          }

          const newInvoice = await prisma.invoice.create({
            data: {
              type: invoice.type || 'INVOICE',
              fileName: invoice.fileName,
              storedFileName: invoice.storedFileName,
              invoiceNumber: invoice.invoiceNumber,
              invoiceDate: invoice.invoiceDate ? new Date(invoice.invoiceDate) : null,
              dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
              parsedData: invoice.parsedData || {},
              totalAmount: invoice.totalAmount,
              status: invoice.status || 'DRAFT',
              paidAt: invoice.paidAt ? new Date(invoice.paidAt) : null,
              cancellationReason: invoice.cancellationReason || null,
              customerId: invoice.customerId ? customerIdMap.get(invoice.customerId) || null : null,
              userId,
            }
          });
          invoiceIdMap.set(invoice.id, newInvoice.id);
          results.invoices.imported++;
        } catch (e) {
          console.error('Invoice import error:', e);
          results.invoices.skipped++;
        }
      }

      // Second pass: update originalInvoiceId for credit notes
      for (const invoice of invoices) {
        if (invoice.originalInvoiceId && invoiceIdMap.has(invoice.id)) {
          const newInvoiceId = invoiceIdMap.get(invoice.id);
          const newOriginalId = invoiceIdMap.get(invoice.originalInvoiceId);
          if (newInvoiceId && newOriginalId) {
            try {
              await prisma.invoice.update({
                where: { id: newInvoiceId },
                data: { originalInvoiceId: newOriginalId }
              });
            } catch (e) {
              console.error('Invoice originalInvoiceId update error:', e);
            }
          }
        }
      }
    }

    // 3. Extract and import expense receipts, then create records
    if (expenses && Array.isArray(expenses)) {
      for (const expense of expenses) {
        try {
          // Extract receipt file if exists
          if (expense.storedReceiptFileName) {
            const receiptFile = zip.file(`receipts/${expense.storedReceiptFileName}`);
            if (receiptFile) {
              const fileBuffer = await receiptFile.async('nodebuffer');
              const filePath = path.join(UPLOAD_BASE_DIR, expense.storedReceiptFileName);
              if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, fileBuffer);
                results.files.imported++;
              } else {
                results.files.skipped++;
              }
            }
          }

          await prisma.expense.create({
            data: {
              description: expense.description,
              amount: expense.amount,
              date: expense.date ? new Date(expense.date) : new Date(),
              category: expense.category || null,
              receiptUrl: expense.receiptUrl || null,
              taxRelevant: expense.taxRelevant ?? true,
              taxDeductiblePercentage: expense.taxDeductiblePercentage || null,
              receiptFileName: expense.receiptFileName || null,
              storedReceiptFileName: expense.storedReceiptFileName || null,
              depreciationYears: expense.depreciationYears || null,
              userId,
            }
          });
          results.expenses.imported++;
        } catch (e) {
          console.error('Expense import error:', e);
          results.expenses.skipped++;
        }
      }
    }

    // 4. Import incomes
    if (incomes && Array.isArray(incomes)) {
      for (const income of incomes) {
        try {
          await prisma.income.create({
            data: {
              description: income.description,
              amount: income.amount,
              date: income.date ? new Date(income.date) : new Date(),
              customerId: income.customerId ? customerIdMap.get(income.customerId) || null : null,
              invoiceId: income.invoiceId ? invoiceIdMap.get(income.invoiceId) || null : null,
              taxRelevant: income.taxRelevant ?? true,
              userId,
            }
          });
          results.incomes.imported++;
        } catch (e) {
          console.error('Income import error:', e);
          results.incomes.skipped++;
        }
      }
    }

    // 5. Import templates
    if (templates && Array.isArray(templates)) {
      for (const template of templates) {
        try {
          const existing = await prisma.invoiceTemplate.findFirst({
            where: { userId, name: template.name }
          });

          if (existing) {
            results.templates.skipped++;
          } else {
            await prisma.invoiceTemplate.create({
              data: {
                name: template.name,
                data: template.data || {},
                userId,
              }
            });
            results.templates.imported++;
          }
        } catch (e) {
          console.error('Template import error:', e);
          results.templates.skipped++;
        }
      }
    }

    // 6. Import/Update settings and logo
    if (settings) {
      try {
        // Extract logo if exists
        let newLogoUrl = settings.logoUrl;
        if (settings.logoUrl) {
          // URL format is /api/files/logo?file=xxx or legacy /uploads/xxx
          const logoMatch = settings.logoUrl.match(/(?:file=|\/uploads\/)(.+?)(?:$|&)/);
          if (logoMatch) {
            const logoFileName = logoMatch[1];
            const logoFile = zip.file(`logos/${logoFileName}`);
            if (logoFile) {
              const fileBuffer = await logoFile.async('nodebuffer');
              const filePath = path.join(UPLOAD_BASE_DIR, logoFileName);
              if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, fileBuffer);
                results.files.imported++;
              }
              // Update logo URL to new API format
              newLogoUrl = `/api/files/logo?file=${logoFileName}`;
            }
          }
        }

        await prisma.settings.upsert({
          where: { userId },
          update: {
            companyName: settings.companyName,
            companyAddress: settings.companyAddress,
            email: settings.email,
            telephone: settings.telephone,
            taxNumber: settings.taxNumber,
            bankName: settings.bankName,
            iban: settings.iban,
            bic: settings.bic,
            footerText: settings.footerText,
            logoUrl: newLogoUrl,
            allowedOrigins: settings.allowedOrigins || null,
          },
          create: {
            userId,
            companyName: settings.companyName,
            companyAddress: settings.companyAddress,
            email: settings.email,
            telephone: settings.telephone,
            taxNumber: settings.taxNumber,
            bankName: settings.bankName,
            iban: settings.iban,
            bic: settings.bic,
            footerText: settings.footerText,
            logoUrl: newLogoUrl,
            allowedOrigins: settings.allowedOrigins || null,
          }
        });
        results.settings.imported = true;
      } catch (e) {
        console.error('Settings import error:', e);
      }
    }

    // 7. Import recurring expenses
    if (recurringExpenses && Array.isArray(recurringExpenses)) {
      for (const recurring of recurringExpenses) {
        try {
          await prisma.recurringExpense.create({
            data: {
              description: recurring.description,
              amount: recurring.amount,
              category: recurring.category || null,
              taxRelevant: recurring.taxRelevant ?? true,
              taxDeductiblePercentage: recurring.taxDeductiblePercentage ?? 100,
              interval: recurring.interval,
              dayOfMonth: recurring.dayOfMonth ?? 1,
              startDate: recurring.startDate ? new Date(recurring.startDate) : new Date(),
              endDate: recurring.endDate ? new Date(recurring.endDate) : null,
              lastExecuted: recurring.lastExecuted ? new Date(recurring.lastExecuted) : null,
              nextExecution: recurring.nextExecution ? new Date(recurring.nextExecution) : new Date(),
              isActive: recurring.isActive ?? true,
              userId,
            }
          });
          results.recurringExpenses.imported++;
        } catch (e) {
          console.error('RecurringExpense import error:', e);
          results.recurringExpenses.skipped++;
        }
      }
    }

    // 8. Import reminders
    if (reminders && Array.isArray(reminders)) {
      for (const reminder of reminders) {
        try {
          const mappedInvoiceId = reminder.invoiceId ? invoiceIdMap.get(reminder.invoiceId) : null;
          if (!mappedInvoiceId) {
            results.reminders.skipped++;
            continue;
          }
          await prisma.reminder.create({
            data: {
              invoiceId: mappedInvoiceId,
              reminderLevel: reminder.reminderLevel ?? 1,
              sentAt: reminder.sentAt ? new Date(reminder.sentAt) : new Date(),
              dueDate: reminder.dueDate ? new Date(reminder.dueDate) : new Date(),
              fee: reminder.fee ?? 0,
              notes: reminder.notes || null,
              userId,
            }
          });
          results.reminders.imported++;
        } catch (e) {
          console.error('Reminder import error:', e);
          results.reminders.skipped++;
        }
      }
    }

    // 9. Import cash books
    if (cashBooks && Array.isArray(cashBooks)) {
      for (const cashBook of cashBooks) {
        try {
          const existing = await prisma.cashBook.findFirst({
            where: { userId, name: cashBook.name }
          });

          if (existing) {
            cashBookIdMap.set(cashBook.id, existing.id);
            results.cashBooks.skipped++;
          } else {
            const newCashBook = await prisma.cashBook.create({
              data: {
                name: cashBook.name || 'Hauptkasse',
                description: cashBook.description || null,
                initialBalance: cashBook.initialBalance ?? 0,
                currency: cashBook.currency || 'EUR',
                isActive: cashBook.isActive ?? true,
                userId,
              }
            });
            cashBookIdMap.set(cashBook.id, newCashBook.id);
            results.cashBooks.imported++;
          }
        } catch (e) {
          console.error('CashBook import error:', e);
          results.cashBooks.skipped++;
        }
      }
    }

    // 10. Import cash transactions
    if (cashTransactions && Array.isArray(cashTransactions)) {
      for (const transaction of cashTransactions) {
        try {
          const mappedCashBookId = transaction.cashBookId ? cashBookIdMap.get(transaction.cashBookId) : null;
          if (!mappedCashBookId) {
            results.cashTransactions.skipped++;
            continue;
          }
          await prisma.cashTransaction.create({
            data: {
              date: transaction.date ? new Date(transaction.date) : new Date(),
              type: transaction.type,
              description: transaction.description,
              amount: transaction.amount,
              runningBalance: transaction.runningBalance,
              category: transaction.category || null,
              receiptNumber: transaction.receiptNumber || null,
              taxRelevant: transaction.taxRelevant ?? true,
              notes: transaction.notes || null,
              cashBookId: mappedCashBookId,
              userId,
            }
          });
          results.cashTransactions.imported++;
        } catch (e) {
          console.error('CashTransaction import error:', e);
          results.cashTransactions.skipped++;
        }
      }
    }

    // 11. Import documentations
    if (documentations && Array.isArray(documentations)) {
      for (const doc of documentations) {
        try {
          await prisma.documentation.create({
            data: {
              version: doc.version || '1.0',
              title: doc.title || 'Verfahrensdokumentation',
              content: doc.content || '{}',
              userId,
            }
          });
          results.documentations.imported++;
        } catch (e) {
          console.error('Documentation import error:', e);
          results.documentations.skipped++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: confirmOverwrite
        ? 'Vollständiges Backup erfolgreich wiederhergestellt (Daten überschrieben)'
        : 'Vollständiges Backup erfolgreich wiederhergestellt',
      results,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Full restore error:', error);
    return NextResponse.json(
      { error: 'Wiederherstellung fehlgeschlagen: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}

