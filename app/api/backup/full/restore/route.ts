import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

const prisma = new PrismaClient();

// POST: Restore user data from ZIP backup including files
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();

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

    const { expenses, incomes, invoices, customers, settings, templates } = backup.data;

    // Ensure upload directory exists - all files go to public/uploads
    const publicUploadsDir = path.join(process.cwd(), 'public', 'uploads');

    if (!fs.existsSync(publicUploadsDir)) {
      fs.mkdirSync(publicUploadsDir, { recursive: true });
    }

    // Track import results
    const results = {
      customers: { imported: 0, skipped: 0 },
      expenses: { imported: 0, skipped: 0 },
      incomes: { imported: 0, skipped: 0 },
      invoices: { imported: 0, skipped: 0 },
      templates: { imported: 0, skipped: 0 },
      files: { imported: 0, skipped: 0 },
      settings: { imported: false },
    };

    // Create ID mapping for relations
    const customerIdMap = new Map<number, number>();
    const invoiceIdMap = new Map<number, number>();

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
                email: customer.email || null,
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
              const filePath = path.join(publicUploadsDir, invoice.storedFileName);
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
              fileName: invoice.fileName,
              storedFileName: invoice.storedFileName,
              invoiceNumber: invoice.invoiceNumber,
              invoiceDate: invoice.invoiceDate ? new Date(invoice.invoiceDate) : null,
              dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
              parsedData: invoice.parsedData || {},
              totalAmount: invoice.totalAmount,
              status: invoice.status || 'DRAFT',
              paidAt: invoice.paidAt ? new Date(invoice.paidAt) : null,
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
              const filePath = path.join(publicUploadsDir, expense.storedReceiptFileName);
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
        if (settings.logoUrl) {
          // URL format is /uploads/logo_xxx.png
          const logoMatch = settings.logoUrl.match(/\/uploads\/(.+)$/);
          if (logoMatch) {
            const logoFileName = logoMatch[1];
            const logoFile = zip.file(`logos/${logoFileName}`);
            if (logoFile) {
              const fileBuffer = await logoFile.async('nodebuffer');
              const filePath = path.join(publicUploadsDir, logoFileName);
              if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, fileBuffer);
                results.files.imported++;
              }
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
            logoUrl: settings.logoUrl,
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
            logoUrl: settings.logoUrl,
          }
        });
        results.settings.imported = true;
      } catch (e) {
        console.error('Settings import error:', e);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Vollständiges Backup erfolgreich wiederhergestellt',
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
