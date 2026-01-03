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
import { createAuditLog } from '@/lib/audit-log';

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
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { name, scopes, expiresInDays } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Validate scopes
    const validScopes = ['read', 'write', 'delete', '*'];
    const requestedScopes = scopes || ['read', 'write'];

    if (!Array.isArray(requestedScopes)) {
      return NextResponse.json({ error: 'Scopes must be an array' }, { status: 400 });
    }

    for (const scope of requestedScopes) {
      if (!validScopes.includes(scope)) {
        return NextResponse.json({ error: `Invalid scope: ${scope}. Valid scopes: ${validScopes.join(', ')}` }, { status: 400 });
      }
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
export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'API key ID is required' }, { status: 400 });
    }

    // Check if API key exists and belongs to user
    const existing = await prisma.apiKey.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Delete the API key (cascades to logs)
    await prisma.apiKey.delete({
      where: { id: parseInt(id) },
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
export async function PUT(request: NextRequest) {
  try {
    const userId = await requireUserId();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { id, name, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'API key ID is required' }, { status: 400 });
    }

    // Check if API key exists and belongs to user
    const existing = await prisma.apiKey.findFirst({
      where: { id: parseInt(id), userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    const apiKey = await prisma.apiKey.update({
      where: { id: parseInt(id) },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
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
