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
    return NextResponse.json(settings ? { ...settings, logoUrl: privateLogoUrl(settings.logoUrl) } : {});
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
    const body = await request.json();
    const { companyName, companyAddress, email, telephone, taxNumber, bankName, iban, bic, footerText, logoUrl } = body;

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
    const settings = await prisma.settings.upsert({
      where: { userId },
      update: {
        companyName,
        companyAddress,
        email,
        telephone,
        taxNumber,
        bankName,
        iban,
        bic,
        footerText,
        logoUrl: ownedLogoUrl,
      },
      create: {
        userId,
        companyName,
        companyAddress,
        email,
        telephone,
        taxNumber,
        bankName,
        iban,
        bic,
        footerText,
        logoUrl: ownedLogoUrl,
      },
    });

    // Record field names only: even masked profile values would unnecessarily
    // retain addresses, contact details, bank data and free-form footer content.
    const profileFields = ['companyName', 'companyAddress', 'email', 'telephone', 'taxNumber', 'bankName', 'iban', 'bic', 'footerText', 'logoUrl'] as const;
    const changedFields = profileFields.filter(field =>
      (previousSettings?.[field] ?? null) !== (settings[field] ?? null));
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

    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}

export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
