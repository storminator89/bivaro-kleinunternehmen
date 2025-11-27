/**
 * API v1 - Settings Endpoint (Read-Only)
 * 
 * GET /api/v1/settings - Get company settings
 * 
 * Note: Settings are read-only via API for security reasons.
 * Use the web interface to modify settings.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  withApiAuth,
  apiSuccess,
  apiError,
  handleCors,
  corsHeaders,
} from '@/lib/api-auth';

export async function OPTIONS() {
  return handleCors();
}

// GET /api/v1/settings
export async function GET(request: NextRequest) {
  return withApiAuth(request, async ({ userId }) => {
    const settings = await prisma.settings.findUnique({
      where: { userId },
      select: {
        companyName: true,
        companyAddress: true,
        email: true,
        telephone: true,
        taxNumber: true,
        bankName: true,
        iban: true,
        bic: true,
        footerText: true,
        logoUrl: true,
      },
    });

    if (!settings) {
      return apiSuccess({
        companyName: null,
        companyAddress: null,
        email: null,
        telephone: null,
        taxNumber: null,
        bankName: null,
        iban: null,
        bic: null,
        footerText: null,
        logoUrl: null,
      });
    }

    // Mask sensitive data partially
    const maskedSettings = {
      ...settings,
      // Show only last 4 digits of IBAN if present
      iban: settings.iban 
        ? `****${settings.iban.slice(-4)}` 
        : null,
    };

    const response = apiSuccess(maskedSettings);

    Object.entries(corsHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }, { requiredScopes: ['read'] });
}

// POST/PUT/DELETE are not allowed - settings should only be modified via web UI
export async function POST() {
  const response = apiError(
    'Settings can only be modified via the web interface for security reasons',
    405,
    'METHOD_NOT_ALLOWED'
  );
  response.headers.set('Allow', 'GET, OPTIONS');
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export async function PUT() {
  const response = apiError(
    'Settings can only be modified via the web interface for security reasons',
    405,
    'METHOD_NOT_ALLOWED'
  );
  response.headers.set('Allow', 'GET, OPTIONS');
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export async function DELETE() {
  const response = apiError(
    'Settings cannot be deleted via API',
    405,
    'METHOD_NOT_ALLOWED'
  );
  response.headers.set('Allow', 'GET, OPTIONS');
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}
