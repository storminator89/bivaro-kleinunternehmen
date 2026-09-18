import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createAuditLog } from '@/lib/audit-log';
import { generateCreditNotePDF } from '@/lib/credit-note-pdf';
import { inTransaction } from '@/lib/db-transaction';
import { previewDocumentNumber, getNextDocumentNumber } from '@/lib/invoice-numbers';
import { writeTenantFile, deleteTenantFile } from '@/lib/upload-path';

// POST: Cancel an invoice by creating a credit note
export async function POST(request: Request) {
    let stagedFile: string | null = null;
    let owner: string | null = null;
    try {
        const userId = await requireUserId();
        owner = userId;
        const { invoiceId, cancellationReason } = await request.json();

        if (!invoiceId) {
            return NextResponse.json({ error: 'Rechnungs-ID ist erforderlich' }, { status: 400 });
        }

        // Get the original invoice with customer
        const originalInvoice = await prisma.invoice.findFirst({
            where: { id: Number(invoiceId), userId },
            include: { customer: true }
        });

        if (!originalInvoice || originalInvoice.type !== 'INVOICE') {
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

        const year = new Date().getFullYear();
        const creditNoteNumber = (await previewDocumentNumber(prisma, userId, 'CREDIT_NOTE', year)).number;

        // Parse the original invoice data
        const parsedData = typeof originalInvoice.parsedData === 'string'
            ? JSON.parse(originalInvoice.parsedData)
            : originalInvoice.parsedData;

        // Extract items from original invoice
        // Handle different structures (legacy uploaded vs manual vs fixed uploaded)
        const items = parsedData?.items || parsedData?.lineItems || [];
        const formattedItems = items.map((item: Record<string, unknown>) => {
            // 1. Determine Quantity
            // In some uploaded invoices (due to bug), quantity is stored in 'date' field
            let quantity = (item.quantity as number) || 1;
            if (!item.quantity && item.date && !isNaN(parseFloat(String(item.date)))) {
                quantity = parseFloat(String(item.date));
            }

            // 2. Determine Unit Price
            // In some uploaded invoices, unitPrice is missing but amount (line total) exists
            let unitPrice = (item.unitPrice as number) || (item.price as number) || 0;
            if (!unitPrice && item.amount) {
                unitPrice = (item.amount as number) / quantity;
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

        // --- Extract customer name ---
        let resolvedName: string | null = originalInvoice.customer?.name ?? null;
        if (!resolvedName && parsedData?.customerName) resolvedName = String(parsedData.customerName);

        // --- Build combined address block ---
        // parsedData.customerAddress (from CreateInvoiceModal) already contains name + street + city
        // buyerInfo is from ZUGFeRD upload; fallback is the linked customer DB record.
        // We pass everything as customerAddress and customerName=null to avoid double-printing.
        let fullAddress = '';

        if (parsedData?.customerAddress) {
            // Already the full block – use as-is
            fullAddress = String(parsedData.customerAddress).trim();
        } else if (parsedData?.buyerInfo && typeof parsedData.buyerInfo === 'object') {
            const bi = parsedData.buyerInfo as Record<string, string | undefined>;
            const parts = [resolvedName, bi.address, [bi.zipCode, bi.city].filter(Boolean).join(' ')].filter(Boolean);
            fullAddress = parts.join('\n');
        } else {
            const c = originalInvoice.customer;
            if (c) {
                const parts = [resolvedName, c.address, [c.zipCode, c.city].filter(Boolean).join(' ')].filter(Boolean);
                fullAddress = parts.join('\n');
            }
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
                customerName: null,           // name is already inside fullAddress
                customerAddress: fullAddress || null,
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
                userId,
            }
        );

        // Save PDF to uploads directory
        const creditNoteFileName = `Gutschrift_${creditNoteNumber}.pdf`;
        const storedFileName = await writeTenantFile(userId, creditNoteFileName, creditNotePdfBytes);
        stagedFile = storedFileName;

        // Modify parsed data to indicate it's a credit note
        const creditNoteParsedData = {
            ...parsedData,
            type: 'CREDIT_NOTE',
            rawXml: null,
            invoiceNumber: creditNoteNumber,
            originalInvoiceNumber: originalInvoice.invoiceNumber,
            cancellationReason: cancellationReason || 'Stornierung der Originalrechnung',
        };

        const creditNote = await inTransaction(async tx => {
            const current = await tx.invoice.findFirst({
                where: { id: originalInvoice.id, userId },
                include: { creditNotes: true, income: true },
            });
            if (!current || current.status === 'CANCELLED' || current.creditNotes.length) {
                throw new Error('Die Rechnung wurde bereits storniert');
            }
            // Legacy paid invoices may have an income date but no paidAt. Keep
            // that realized booking date when the original is cancelled.
            const cancellationPaidAt = current.paidAt ?? (
                current.status === 'PAID' ? current.income?.date ?? null : null
            );
            const reserved = await getNextDocumentNumber(tx, userId, 'CREDIT_NOTE', year);
            if (reserved !== creditNoteNumber) throw new Error('Nummer wurde zwischenzeitlich vergeben. Bitte erneut versuchen.');
            const created = await tx.invoice.create({ data: {
                type: 'CREDIT_NOTE', fileName: creditNoteFileName, storedFileName,
                invoiceDate: new Date(), invoiceNumber: reserved, parsedData: creditNoteParsedData,
                totalAmount: -Math.abs(originalInvoice.totalAmount ?? 0), status: 'SENT',
                originalInvoiceId: originalInvoice.id, cancellationReason: cancellationReason || null,
                customerId: originalInvoice.customerId, userId,
            } });
            await tx.invoice.update({
                where: { id: originalInvoice.id, userId },
                data: {
                    status: 'CANCELLED',
                    paidAt: cancellationPaidAt,
                    cancellationReason: cancellationReason || null,
                },
            });
            return created;
        });
        stagedFile = null;

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
        if (stagedFile && owner) await deleteTenantFile(owner, stagedFile).catch(() => undefined);
        if (error instanceof UnauthorizedError) {
            return unauthorizedResponse();
        }
        console.error('Error cancelling invoice:', error);
        return NextResponse.json({ error: 'Stornierung nicht möglich. Bitte Beleg prüfen und gegebenenfalls erneut versuchen.' }, { status: 409 });
    }
}
