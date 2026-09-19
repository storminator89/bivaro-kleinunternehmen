import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createFinancialAuditLog } from '@/lib/audit-log';
import { generateCreditNotePDF } from '@/lib/credit-note-pdf';
import { inTransaction } from '@/lib/db-transaction';
import { previewDocumentNumber, getNextDocumentNumber } from '@/lib/invoice-numbers';
import { writeTenantFile, deleteTenantFile } from '@/lib/upload-path';
import { getEInvoiceBookingRejection, getRawEInvoiceXml, parseEInvoiceXml } from '@/lib/e-invoice-parser';

class CancellationUnsupportedError extends Error {
    readonly status = 422;
}

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

        const importRejection = await getEInvoiceBookingRejection(parsedData);
        if (importRejection) {
            return NextResponse.json({ error: `Stornierung nicht möglich: ${importRejection}` }, { status: 422 });
        }

        // Older imports did not persist the parsed monetary fields. Re-read
        // their bounded raw XML so cancellation uses the source totals and
        // line adjustments instead of silently reconstructing them.
        let sourceData: Record<string, unknown> = parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)
            ? parsedData as Record<string, unknown>
            : {};
        const storedRawXml = getRawEInvoiceXml(parsedData);
        const isStoredEInvoice = Boolean(storedRawXml || sourceData.eInvoiceFormat || sourceData.documentType || sourceData.currency);
        if (storedRawXml) {
            try {
                const reparsed = await parseEInvoiceXml(storedRawXml);
                sourceData = { ...sourceData, ...reparsed };
            } catch {
                return NextResponse.json({ error: 'Stornierung nicht möglich: Die gespeicherte E-Rechnungs-XML konnte nicht gelesen werden.' }, { status: 422 });
            }
        }

        // Extract items from original invoice
        // Handle different structures (legacy uploaded vs manual vs fixed uploaded)
        const items = sourceData.lineItems || sourceData.items || [];
        const formattedItems = Array.isArray(items) ? items.map((item: Record<string, unknown>) => {
            // 1. Determine Quantity
            // In some uploaded invoices (due to bug), quantity is stored in 'date' field
            const toFiniteNumber = (value: unknown): number | null => {
                if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
                const number = Number(value);
                return Number.isFinite(number) ? number : null;
            };
            const rawQuantity = toFiniteNumber(item.quantity);
            let quantity = rawQuantity !== null && rawQuantity !== 0 ? rawQuantity : 1;
            if ((rawQuantity === null || rawQuantity === 0) && item.date && !isNaN(parseFloat(String(item.date)))) {
                quantity = parseFloat(String(item.date));
            }

            // 2. Determine Unit Price
            // In some uploaded invoices, unitPrice is missing but amount (line total) exists
            const amount = toFiniteNumber(item.amount);
            const rawBaseQuantity = toFiniteNumber(item.baseQuantity ?? item.priceBaseQuantity);
            const baseQuantity = rawBaseQuantity !== null && rawBaseQuantity > 0 ? rawBaseQuantity : null;
            let unitPrice = toFiniteNumber(item.unitPrice ?? item.price);
            if (amount === null && unitPrice === null) {
                throw new CancellationUnsupportedError('Stornierung nicht möglich: Für eine Position fehlen sowohl der Originalbetrag als auch der Einzelpreis.');
            }
            if (unitPrice === null) {
                unitPrice = amount !== null ? amount * (baseQuantity ?? 1) / quantity : 0;
            }

            return {
                description: String(item.description || item.name || 'Position'),
                quantity: quantity,
                unitPrice: unitPrice,
                baseQuantity,
                baseUnit: typeof item.baseUnit === 'string' ? item.baseUnit : null,
                amount,
                unit: String(item.unit || 'Stück'),
                taxRate: Number(item.taxRate) || 0,
                allowances: Array.isArray(item.allowances) ? item.allowances : [],
                charges: Array.isArray(item.charges) ? item.charges : [],
            };
        }) : [];

        const finiteOrNull = (value: unknown): number | null => {
            if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        };
        const sourceNetAmount = finiteOrNull(sourceData.netAmount);
        const sourceTaxAmount = finiteOrNull(sourceData.taxAmount);
        const sourceGrossAmount = finiteOrNull(sourceData.grossAmount)
            ?? finiteOrNull(sourceData.totalAmount)
            ?? finiteOrNull(originalInvoice.totalAmount);
        const sourceAllowanceTotal = finiteOrNull(sourceData.allowanceTotalAmount);
        const sourceChargeTotal = finiteOrNull(sourceData.chargeTotalAmount);
        if (sourceGrossAmount === null) {
            return NextResponse.json({ error: 'Stornierung nicht möglich: Der ursprüngliche Bruttogesamtbetrag fehlt.' }, { status: 422 });
        }
        if (isStoredEInvoice && sourceGrossAmount !== 0 && formattedItems.length === 0) {
            throw new CancellationUnsupportedError('Stornierung nicht möglich: Die ursprünglichen Positionen fehlen.');
        }

        // --- Extract customer name ---
        let resolvedName: string | null = originalInvoice.customer?.name ?? null;
        if (!resolvedName && sourceData.customerName) resolvedName = String(sourceData.customerName);

        // --- Build combined address block ---
        // parsedData.customerAddress (from CreateInvoiceModal) already contains name + street + city
        // buyerInfo is from ZUGFeRD upload; fallback is the linked customer DB record.
        // We pass everything as customerAddress and customerName=null to avoid double-printing.
        let fullAddress = '';

        if (sourceData.customerAddress) {
            // Already the full block – use as-is
            fullAddress = String(sourceData.customerAddress).trim();
        } else if (sourceData.buyerInfo && typeof sourceData.buyerInfo === 'object') {
            const bi = sourceData.buyerInfo as Record<string, unknown>;
            const addressLines = Array.isArray(bi.addressLines)
                ? bi.addressLines.map(value => String(value)).filter(Boolean)
                : (bi.address ? [String(bi.address)] : []);
            const parts = [resolvedName, ...addressLines, [bi.zipCode, bi.city].filter(Boolean).join(' ')].filter(Boolean);
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
                totalAmount: sourceGrossAmount,
                netAmount: sourceNetAmount,
                taxAmount: sourceTaxAmount,
                grossAmount: sourceGrossAmount,
                allowanceTotalAmount: sourceAllowanceTotal,
                chargeTotalAmount: sourceChargeTotal,
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
            ...sourceData,
            type: 'CREDIT_NOTE',
            documentType: 'CREDIT_NOTE',
            documentTypeCode: '381',
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
                totalAmount: -Math.abs(sourceGrossAmount), status: 'SENT', issuanceState: 'ISSUED',
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
            await createFinancialAuditLog({
                userId,
                action: 'CANCELLED',
                entityType: 'Invoice',
                entityId: originalInvoice.id,
                entityName: current.invoiceNumber || current.fileName,
                oldValues: { status: current.status, paidAt: current.paidAt },
                newValues: { status: 'CANCELLED', cancellationReason: cancellationReason || null, creditNoteId: created.id },
                metadata: {
                    actorId: userId,
                    tenantId: userId,
                    operation: 'invoice.cancel',
                    originalReference: current.invoiceNumber ?? `invoice:${current.id}`,
                    reason: cancellationReason || 'invoice cancelled with credit note',
                },
            }, tx);
            await createFinancialAuditLog({
                userId,
                action: 'CREATE',
                entityType: 'CreditNote',
                entityId: created.id,
                entityName: reserved,
                newValues: { originalInvoiceId: current.id, totalAmount: created.totalAmount, status: created.status },
                metadata: {
                    actorId: userId,
                    tenantId: userId,
                    operation: 'credit-note.create',
                    originalReference: current.invoiceNumber ?? `invoice:${current.id}`,
                    reason: cancellationReason || 'credit note created for cancellation',
                },
            }, tx);
            return created;
        });
        stagedFile = null;

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
        if (error instanceof CancellationUnsupportedError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('Error cancelling invoice:', error);
        return NextResponse.json({ error: 'Stornierung nicht möglich. Bitte Beleg prüfen und gegebenenfalls erneut versuchen.' }, { status: 409 });
    }
}
