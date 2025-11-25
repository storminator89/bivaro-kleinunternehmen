import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

const prisma = new PrismaClient();

// GET: Export all user data as ZIP including files
export async function GET() {
  try {
    const userId = await requireUserId();

    // Fetch all user data
    const [user, expenses, incomes, invoices, customers, settings, templates] = await Promise.all([
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
    ]);

    // Create backup metadata
    const backup = {
      version: "1.0",
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
      },
      stats: {
        expenses: expenses.length,
        incomes: incomes.length,
        invoices: invoices.length,
        customers: customers.length,
        templates: templates.length,
      }
    };

    // Create ZIP archive
    const zip = new JSZip();

    // Add JSON backup
    zip.file('backup.json', JSON.stringify(backup, null, 2));

    // Paths to check for files - PDFs are in public/uploads
    const publicUploadsDir = path.join(process.cwd(), 'public', 'uploads');
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const receiptsDir = path.join(uploadsDir, 'receipts');
    const logosDir = path.join(uploadsDir, 'logos');

    // Add invoice PDFs (stored in public/uploads)
    for (const invoice of invoices) {
      if (invoice.storedFileName) {
        const filePath = path.join(publicUploadsDir, invoice.storedFileName);
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath);
          zip.file(`invoices/${invoice.storedFileName}`, fileContent);
        }
      }
    }

    // Add expense receipts (also stored in public/uploads)
    for (const expense of expenses) {
      if (expense.storedReceiptFileName) {
        const filePath = path.join(publicUploadsDir, expense.storedReceiptFileName);
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath);
          zip.file(`receipts/${expense.storedReceiptFileName}`, fileContent);
        }
      }
    }

    // Add logo if exists (also stored in public/uploads)
    if (settings?.logoUrl) {
      // URL format is /uploads/logo_xxx.png
      const logoMatch = settings.logoUrl.match(/\/uploads\/(.+)$/);
      if (logoMatch) {
        const logoFileName = logoMatch[1];
        const logoPath = path.join(publicUploadsDir, logoFileName);
        if (fs.existsSync(logoPath)) {
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

    return new NextResponse(zipBuffer, {
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
