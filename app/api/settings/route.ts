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

export async function POST(request: Request) {
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

    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
