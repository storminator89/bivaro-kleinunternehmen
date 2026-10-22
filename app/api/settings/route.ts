import { parsePaymentTermDays, PaymentTermError } from '@/lib/payment-terms';
import { readFiscalProfile, validateFiscalProfileInput } from '@/lib/fiscal-profile';
import { createAuditLog } from '@/lib/audit-log';
import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { findTenantUploadedFile, isSafeLegacyFileName, isSafeStoredFileName, privateLogoUrl } from '@/lib/upload-path';
import { isLegacyFileOwnedByUser } from '@/lib/upload-ownership';

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await prisma.settings.findUnique({
      where: { userId },
    });
    return NextResponse.json({ ...settings, ...readFiscalProfile(settings), ...(settings ? { logoUrl: privateLogoUrl(settings.logoUrl) } : {}) });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

async function postHandler(request: Request) {
  try {
    const userId = await requireUserId();
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'Ein JSON-Objekt mit Einstellungen ist erforderlich.' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Ungültiges JSON.' }, { status: 400 });
    }
    const fiscalInput = validateFiscalProfileInput(body);
    if (!fiscalInput.ok) {
      return NextResponse.json({ error: 'Bitte das Steuerprofil prüfen.', fieldErrors: fiscalInput.fieldErrors }, { status: 400 });
    }
    const paymentTermData = Object.hasOwn(body, 'paymentTermDays') ? { paymentTermDays: parsePaymentTermDays(body.paymentTermDays) } : {};
    const { logoUrl } = body;
    const companyFields = ['companyName', 'companyAddress', 'email', 'telephone', 'taxNumber', 'bankName', 'iban', 'bic', 'footerText'] as const;
    const companyData: Partial<Record<typeof companyFields[number], string | null>> = {};
    for (const field of companyFields) {
      const value = body[field];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        return NextResponse.json({ error: `Ungültiger Wert für ${field}.`, fieldErrors: { [field]: 'Text oder null erforderlich.' } }, { status: 400 });
      }
      if (value !== undefined) companyData[field] = value;
    }

    let ownedLogoUrl: string | null = null;
    if (logoUrl !== undefined && logoUrl !== null && logoUrl !== '') {
      if (typeof logoUrl !== 'string') {
        return NextResponse.json({ error: 'Ungültige Logo-Referenz' }, { status: 400 });
      }
      const match = logoUrl.match(/^\/api\/files\/logo\?file=([^&]+)$/u) || logoUrl.match(/^\/uploads\/([^&]+)$/u);
      if (!match) {
        return NextResponse.json({ error: 'Ungültige Logo-Referenz' }, { status: 400 });
      }
      let storedName: string;
      try { storedName = decodeURIComponent(match[1]); } catch {
        return NextResponse.json({ error: 'Ungültige Logo-Referenz' }, { status: 400 });
      }
      const tenantFile = isSafeStoredFileName(storedName) ? findTenantUploadedFile(userId, storedName) : null;
      const legacyOwned = !tenantFile && isSafeLegacyFileName(storedName)
        ? await isLegacyFileOwnedByUser(userId, storedName)
        : false;
      if (!tenantFile && !legacyOwned) {
        return NextResponse.json({ error: 'Logo nicht gefunden' }, { status: 404 });
      }
      ownedLogoUrl = `/api/files/logo?file=${encodeURIComponent(storedName)}`;
    }

    const previousSettings = await prisma.settings.findUnique({ where: { userId } });
    const selection = fiscalInput.selection;
    const previousFiscal = readFiscalProfile(previousSettings);
    const fiscalData = selection ? {
      ...selection,
      fiscalConfirmedAt: selection.fiscalTaxRegime === 'UNSET' ? null :
        previousFiscal.fiscalTaxRegime === selection.fiscalTaxRegime &&
        previousFiscal.fiscalEffectiveFrom === selection.fiscalEffectiveFrom && previousFiscal.fiscalConfirmedAt
          ? new Date(previousFiscal.fiscalConfirmedAt) : new Date(),
    } : {};
    const settings = await prisma.settings.upsert({
      where: { userId },
      update: {
        ...companyData,
        ...paymentTermData,
        ...fiscalData,
        ...(logoUrl !== undefined ? { logoUrl: ownedLogoUrl } : {}),
      },
      create: {
        userId,
        ...companyData,
        ...paymentTermData,
        ...fiscalData,
        ...(logoUrl !== undefined ? { logoUrl: ownedLogoUrl } : {}),
      },
    });

    // Record field names only: even masked profile values would unnecessarily
    // retain addresses, contact details, bank data and free-form footer content.
    const profileFields = ['companyName', 'companyAddress', 'email', 'telephone', 'taxNumber', 'bankName', 'iban', 'bic', 'footerText', 'logoUrl', 'fiscalTaxRegime', 'fiscalEffectiveFrom', 'fiscalConfirmedAt', 'paymentTermDays'] as const;
    const changedFields = profileFields.filter(field =>
      String(previousSettings?.[field] ?? null) !== String(settings[field] ?? null));
    if (changedFields.length > 0) {
      await createAuditLog({
        userId,
        action: 'SETTINGS_CHANGED',
        entityType: 'Settings',
        entityId: settings.id,
        entityName: 'Firmenprofil',
        metadata: {
          operation: 'settings.company-profile.save',
          created: previousSettings === null,
          changedFields,
        },
      });
    }

    return NextResponse.json({ ...settings, ...readFiscalProfile(settings), logoUrl: privateLogoUrl(settings.logoUrl) });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    if (error instanceof PaymentTermError) return NextResponse.json({ error: error.message, fieldErrors: { paymentTermDays: error.message } }, { status: error.status });
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}

export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
