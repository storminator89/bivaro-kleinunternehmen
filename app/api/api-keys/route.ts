import { protectMutation, MAX_API_JSON_BODY_BYTES } from '@/lib/request-security';
/**
 * API Keys Management Endpoint
 * 
 * POST   /api/api-keys     - Create new API key
 * GET    /api/api-keys     - List all API keys
 * DELETE /api/api-keys?id= - Revoke API key
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { generateApiKey } from '@/lib/api-auth';
import { createAuditLog, auditSecurityEvent } from '@/lib/audit-log';

function parseKeyId(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// GET - List all API keys for the current user
export async function GET(_request: Request) {
  try {
    const userId = await requireUserId();

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    // Parse scopes JSON
    const formattedKeys = apiKeys.map(key => ({
      ...key,
      scopes: key.scopes ? JSON.parse(key.scopes) : ['read', 'write'],
    }));

    return NextResponse.json(formattedKeys);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error fetching API keys:', error);
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 });
  }
}

// POST - Create new API key
async function postHandler(request: NextRequest) {
  try {
    const userId = await requireUserId();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isJsonObject(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const { name, scopes, expiresInDays } = body;

    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 255) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Validate scopes
    const validScopes = ['read', 'write', 'delete', '*', 'mcp:read', 'mcp:write'];
    const requestedScopes = scopes === undefined ? ['read', 'write'] : scopes;

    if (!Array.isArray(requestedScopes)) {
      return NextResponse.json({ error: 'Scopes must be an array' }, { status: 400 });
    }

    for (const scope of requestedScopes) {
      if (!validScopes.includes(scope)) {
        return NextResponse.json({ error: `Invalid scope: ${scope}. Valid scopes: ${validScopes.join(', ')}` }, { status: 400 });
      }
    }

    if (expiresInDays !== undefined && expiresInDays !== null &&
      (typeof expiresInDays !== 'number' || !Number.isSafeInteger(expiresInDays) || expiresInDays < 1 ||
        !Number.isFinite(new Date(Date.now() + expiresInDays * 86_400_000).getTime()))) {
      return NextResponse.json({ error: 'Expiration must be a positive whole number of days' }, { status: 400 });
    }

    const isMcp = requestedScopes.some(scope => typeof scope === 'string' && scope.startsWith('mcp:'));
    if (isMcp && (!requestedScopes.includes('mcp:read') || requestedScopes.some(scope => !['mcp:read', 'mcp:write'].includes(scope)))) {
      return NextResponse.json({ error: 'MCP-Zugänge benötigen mcp:read und dürfen keine REST-Rechte enthalten.' }, { status: 400 });
    }
    if (requestedScopes.includes('mcp:write') && process.env.BIVARO_MCP_ALLOW_WRITES !== '1') {
      return NextResponse.json({ error: 'MCP-Schreibzugriff ist am Server gesperrt.' }, { status: 403 });
    }
    if (isMcp && (typeof expiresInDays !== 'number' || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)) {
      return NextResponse.json({ error: 'MCP-Zugänge benötigen eine Laufzeit von 1 bis 365 Tagen.' }, { status: 400 });
    }

    // Check max API keys per user (limit to 10)
    const existingCount = await prisma.apiKey.count({ where: { userId } });
    if (existingCount >= 10) {
      return NextResponse.json({ error: 'Maximum of 10 API keys per user' }, { status: 400 });
    }

    // Generate new API key
    const { key, keyHash, keyPrefix } = generateApiKey();

    // Calculate expiration
    let expiresAt = null;
    if (expiresInDays && typeof expiresInDays === 'number' && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    // Create API key record
    const apiKey = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyHash,
        keyPrefix,
        scopes: JSON.stringify(requestedScopes),
        expiresAt,
        userId,
      },
    });

    // Audit log
    await createAuditLog({
      userId,
      action: 'API_KEY_CREATED',
      entityType: 'ApiKey',
      entityId: apiKey.id,
      entityName: apiKey.name,
      newValues: {
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        scopes: requestedScopes,
        expiresAt: apiKey.expiresAt,
      },
    });

    if (isMcp) await auditSecurityEvent(userId, { event: 'MCP_ACCESS_CREATED', outcome: 'success', severity: 'info', metadata: { apiKeyId: apiKey.id, scopes: requestedScopes } });

    // Return the full key ONLY on creation (never shown again)
    return NextResponse.json({
      id: apiKey.id,
      name: apiKey.name,
      key, // IMPORTANT: This is the only time the full key is shown!
      keyPrefix: apiKey.keyPrefix,
      scopes: requestedScopes,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      warning: 'Save this API key now! It will not be shown again.',
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error creating API key:', error);
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
  }
}

// DELETE - Revoke/delete an API key
async function deleteHandler(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = parseKeyId(url.searchParams.get('id'));

    if (!id) {
      return NextResponse.json({ error: 'API key ID is required' }, { status: 400 });
    }

    // Check if API key exists and belongs to user
    const existing = await prisma.apiKey.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Delete the API key (cascades to logs)
    await prisma.apiKey.delete({
      where: { id, userId },
    });

    // Audit log
    await createAuditLog({
      userId,
      action: 'API_KEY_REVOKED',
      entityType: 'ApiKey',
      entityId: existing.id,
      entityName: existing.name,
      oldValues: {
        name: existing.name,
        keyPrefix: existing.keyPrefix,
      },
    });

    return NextResponse.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error deleting API key:', error);
    return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
  }
}

// PUT - Update API key (enable/disable, rename)
async function putHandler(request: NextRequest) {
  try {
    const userId = await requireUserId();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isJsonObject(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const { name, isActive } = body;
    const id = parseKeyId(body.id);

    if (!id) {
      return NextResponse.json({ error: 'API key ID is required' }, { status: 400 });
    }

    if ((name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 255)) ||
      (isActive !== undefined && typeof isActive !== 'boolean')) {
      return NextResponse.json({ error: 'Invalid API key name or active state' }, { status: 400 });
    }

    // Check if API key exists and belongs to user
    const existing = await prisma.apiKey.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    const apiKey = await prisma.apiKey.update({
      where: { id, userId },
      data: {
        ...(typeof name === 'string' && { name: name.trim() }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      ...apiKey,
      scopes: apiKey.scopes ? JSON.parse(apiKey.scopes) : ['read', 'write'],
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error updating API key:', error);
    return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
  }
}

export const POST = protectMutation(postHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
export const DELETE = protectMutation(deleteHandler);
export const PUT = protectMutation(putHandler, { maxBodyBytes: MAX_API_JSON_BODY_BYTES });
