import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createAuditLog } from '@/lib/audit-log';
import { generateCreditNotePDF } from '@/lib/credit-note-pdf';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

// POST: Cancel an invoice by creating a credit note
export async function POST(request: Request) {
    try {
        const userId = await requireUserId();
        const { invoiceId, cancellationReason } = await request.json();

        if (!invoiceId) {
            return NextResponse.json({ error: 'Rechnungs-ID ist erforderlich' }, { status: 400 });
        }

        // Get the original invoice with customer
        const originalInvoice = await prisma.invoice.findFirst({
            where: { id: Number(invoiceId), userId },
            include: { customer: true }
        });

        if (!originalInvoice) {
            return NextResponse.json({ error: 'Rechnung nicht gefunden' }, { status: 404 });
        }

        // Check if already cancelled
        if (originalInvoice.status === 'CANCELLED') {
            return NextResponse.json({ error: 'Diese Rechnung wurde bereits storniert' }, { status: 400 });
        }

        // Check if invoice has existing credit notes
        const existingCreditNote = await prisma.invoice.findFirst({
            where: { originalInvoiceId: Number(invoiceId), userId }
        });

        if (existingCreditNote) {
            return NextResponse.json({ error: 'Für diese Rechnung existiert bereits eine Gutschrift' }, { status: 400 });
        }

        // Get user settings for PDF generation
        const settings = await prisma.settings.findUnique({
            where: { userId }
        });

        // Generate credit note number
        const year = new Date().getFullYear();
        const lastCreditNote = await prisma.invoice.findFirst({
            where: {
                userId,
                type: 'CREDIT_NOTE',
                invoiceNumber: { startsWith: `GS-${year}-` }
            },
            orderBy: { invoiceNumber: 'desc' }
        });

        let nextNumber = 1;
        if (lastCreditNote?.invoiceNumber) {
            const match = lastCreditNote.invoiceNumber.match(/GS-\d{4}-(\d+)/);
            if (match) {
                nextNumber = parseInt(match[1], 10) + 1;
            }
        }
        const creditNoteNumber = `GS-${year}-${nextNumber.toString().padStart(2, '0')}`;

        // Parse the original invoice data
        const parsedData = typeof originalInvoice.parsedData === 'string'
            ? JSON.parse(originalInvoice.parsedData)
            : originalInvoice.parsedData;

        // Extract items from original invoice
        // Handle different structures (legacy uploaded vs manual vs fixed uploaded)
        const items = parsedData?.items || parsedData?.lineItems || [];
        const formattedItems = items.map((item: any) => {
            // 1. Determine Quantity
            // In some uploaded invoices (due to bug), quantity is stored in 'date' field
            let quantity = item.quantity;
            if (!quantity && item.date && !isNaN(parseFloat(item.date))) {
                quantity = parseFloat(item.date);
            }
            quantity = quantity || 1;

            // 2. Determine Unit Price
            // In some uploaded invoices, unitPrice is missing but amount (line total) exists
            let unitPrice = item.unitPrice || item.price;
            if (!unitPrice && item.amount) {
                unitPrice = item.amount / quantity;
            }
            unitPrice = unitPrice || 0;

            return {
                description: item.description || item.name || 'Position',
                quantity: quantity,
                unitPrice: unitPrice,
                unit: item.unit || 'Stück',
                taxRate: item.taxRate || 0,
            };
        });

        // Build customer address
        let customerAddress = '';
        if (originalInvoice.customer) {
            const c = originalInvoice.customer;
            if (c.address) customerAddress += c.address;
            const cityLine = [c.zipCode, c.city].filter(Boolean).join(' ');
            if (cityLine) customerAddress += (customerAddress ? '\n' : '') + cityLine;
        }

        // Generate credit note PDF
        const creditNotePdfBytes = await generateCreditNotePDF(
            {
                creditNoteNumber,
                date: new Date(),
                originalInvoiceNumber: originalInvoice.invoiceNumber,
                originalInvoiceDate: originalInvoice.invoiceDate,
                cancellationReason: cancellationReason || 'Stornierung der Originalrechnung',
                totalAmount: originalInvoice.totalAmount || 0,
                customerName: originalInvoice.customer?.name || null,
                customerAddress: customerAddress || null,
                items: formattedItems,
            },
            {
                companyName: settings?.companyName,
                companyAddress: settings?.companyAddress,
                email: settings?.email,
                telephone: settings?.telephone,
                taxNumber: settings?.taxNumber,
                bankName: settings?.bankName,
                iban: settings?.iban,
                bic: settings?.bic,
                footerText: settings?.footerText,
                logoUrl: settings?.logoUrl,
            }
        );

        // Save PDF to uploads directory
        const creditNoteFileName = `Gutschrift_${creditNoteNumber}.pdf`;
        const storedFileName = `${Date.now()}_${creditNoteFileName}`;
        const uploadsDir = path.join(process.cwd(), 'data', 'uploads');

        // Ensure uploads directory exists
        await fs.mkdir(uploadsDir, { recursive: true });

        const pdfPath = path.join(uploadsDir, storedFileName);
        await fs.writeFile(pdfPath, creditNotePdfBytes);

        // Modify parsed data to indicate it's a credit note
        const creditNoteParsedData = {
            ...parsedData,
            type: 'CREDIT_NOTE',
            originalInvoiceNumber: originalInvoice.invoiceNumber,
            cancellationReason: cancellationReason || 'Stornierung der Originalrechnung',
        };

        // Create credit note record
        const creditNote = await prisma.invoice.create({
            data: {
                type: 'CREDIT_NOTE',
                fileName: creditNoteFileName,
                storedFileName: storedFileName,
                invoiceDate: new Date(),
                invoiceNumber: creditNoteNumber,
                parsedData: creditNoteParsedData,
                totalAmount: originalInvoice.totalAmount ? -Math.abs(originalInvoice.totalAmount) : null,
                status: 'SENT',
                originalInvoiceId: originalInvoice.id,
                cancellationReason: cancellationReason || null,
                customerId: originalInvoice.customerId,
                userId,
            },
        });

        // Update original invoice status to CANCELLED
        await prisma.invoice.update({
            where: { id: originalInvoice.id },
            data: {
                status: 'CANCELLED',
                cancellationReason: cancellationReason || null
            },
        });

        // Create audit log entries
        await createAuditLog({
            userId,
            action: 'CANCELLED',
            entityType: 'Invoice',
            entityId: originalInvoice.id.toString(),
            entityName: originalInvoice.invoiceNumber || originalInvoice.fileName,
            oldValues: { status: originalInvoice.status },
            newValues: {
                status: 'CANCELLED',
                cancellationReason,
                creditNoteId: creditNote.id,
                creditNoteNumber
            },
        });

        await createAuditLog({
            userId,
            action: 'CREATE',
            entityType: 'CreditNote',
            entityId: creditNote.id.toString(),
            entityName: creditNoteNumber,
            newValues: {
                originalInvoiceId: originalInvoice.id,
                originalInvoiceNumber: originalInvoice.invoiceNumber,
                totalAmount: creditNote.totalAmount,
                pdfGenerated: true,
            },
        });

        return NextResponse.json({
            success: true,
            creditNote: {
                id: creditNote.id,
                invoiceNumber: creditNote.invoiceNumber,
                totalAmount: creditNote.totalAmount,
                fileName: creditNoteFileName,
            },
            originalInvoice: {
                id: originalInvoice.id,
                invoiceNumber: originalInvoice.invoiceNumber,
                newStatus: 'CANCELLED'
            }
        });
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return unauthorizedResponse();
        }
        console.error('Error cancelling invoice:', error);
        return NextResponse.json({ error: 'Fehler beim Stornieren der Rechnung' }, { status: 500 });
    }
}
