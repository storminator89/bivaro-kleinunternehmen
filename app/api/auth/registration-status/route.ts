import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { APP_SETTINGS_KEY, isBootstrapTokenConfigured } from '@/lib/auth-registration';

export async function GET() {
  try {
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;

    const appSettings = await prisma.appSettings.findUnique({
      where: { singletonKey: APP_SETTINGS_KEY },
    });

    // An empty instance is available only when the server has been configured
    // with the one-time bootstrap token. The token itself is never returned.
    if (isFirstUser) {
      const bootstrapConsumed = appSettings?.bootstrapConsumedAt !== null && appSettings?.bootstrapConsumedAt !== undefined;
      const bootstrapConfigured = isBootstrapTokenConfigured() && !bootstrapConsumed;
      return NextResponse.json({
        isFirstUser: true,
        allowRegistration: bootstrapConfigured,
        bootstrapRequired: !bootstrapConsumed,
        bootstrapConsumed,
      });
    }

    // Ansonsten App-Einstellungen prüfen
    return NextResponse.json({
      isFirstUser: false,
      allowRegistration: appSettings?.allowRegistration ?? false,
      bootstrapRequired: false,
    });
  } catch (error) {
    console.error("Error checking registration status:", error);
    return NextResponse.json(
      { error: "Failed to check registration status" },
      { status: 500 }
    );
  }
}
