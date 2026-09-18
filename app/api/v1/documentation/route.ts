import { auditCreate, auditUpdate, auditDelete } from '@/lib/audit-log';
/**
 * API v1 - Documentation Endpoint
 * 
 * GET    /api/v1/documentation      - List all documentations
 * POST   /api/v1/documentation      - Create documentation
 * PUT    /api/v1/documentation?id=  - Update documentation
 * DELETE /api/v1/documentation?id=  - Delete documentation
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

export async function OPTIONS(request: NextRequest) {
    return handleCors(request);
}

// GET /api/v1/documentation
export async function GET(request: NextRequest) {
    return withApiAuth(request, async ({ userId }) => {
        const url = new URL(request.url);
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
        const skip = (page - 1) * pageSize;

        const [documentations, total] = await Promise.all([
            prisma.documentation.findMany({
                where: { userId },
                orderBy: { updatedAt: 'desc' },
                skip,
                take: pageSize,
                select: {
                    id: true,
                    version: true,
                    title: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.documentation.count({ where: { userId } }),
        ]);

        const response = apiSuccess(documentations, {
            page,
            pageSize,
            total,
            hasMore: skip + documentations.length < total,
        });

        Object.entries(corsHeaders()).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return response;
    }, { requiredScopes: ['read'] });
}

// POST /api/v1/documentation
export async function POST(request: NextRequest) {
    return withApiAuth(request, async ({ userId }) => {
        let body;
        try {
            body = await request.json();
        } catch {
            return apiError('Invalid JSON body', 400, 'INVALID_JSON');
        }

        const { version, title, content } = body;

        // Validation
        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return apiError('Title is required', 400, 'VALIDATION_ERROR');
        }

        if (!content || typeof content !== 'string') {
            return apiError('Content is required', 400, 'VALIDATION_ERROR');
        }

        const documentation = await prisma.documentation.create({
            data: {
                version: version?.trim() || '1.0',
                title: title.trim(),
                content: content,
                userId,
            },
        });
    await auditCreate(userId, 'Documentation', documentation);

        const response = apiSuccess(documentation);
        response.headers.set('Location', `/api/v1/documentation/${documentation.id}`);
        Object.entries(corsHeaders()).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return new Response(response.body, {
            status: 201,
            headers: response.headers,
        });
    }, { requiredScopes: ['write'] });
}

// PUT /api/v1/documentation?id=<id>
export async function PUT(request: NextRequest) {
    return withApiAuth(request, async ({ userId }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return apiError('Documentation ID is required', 400, 'MISSING_ID');
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return apiError('Invalid JSON body', 400, 'INVALID_JSON');
        }

        const { version, title, content } = body;

        // Check if documentation exists and belongs to user
        const existing = await prisma.documentation.findFirst({
            where: { id: parseInt(id), userId },
        });

        if (!existing) {
            return apiError('Documentation not found', 404, 'NOT_FOUND');
        }

        const documentation = await prisma.documentation.update({
            where: { id: parseInt(id) },
            data: {
                ...(version !== undefined && { version: version.trim() }),
                ...(title !== undefined && { title: title.trim() }),
                ...(content !== undefined && { content }),
            },
        });
    await auditUpdate(userId, 'Documentation', existing.id, existing, documentation);

        const response = apiSuccess(documentation);
        Object.entries(corsHeaders()).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
        return response;
    }, { requiredScopes: ['write'] });
}

// DELETE /api/v1/documentation?id=<id>
export async function DELETE(request: NextRequest) {
    return withApiAuth(request, async ({ userId }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return apiError('Documentation ID is required', 400, 'MISSING_ID');
        }

        // Check if documentation exists and belongs to user
        const existing = await prisma.documentation.findFirst({
            where: { id: parseInt(id), userId },
        });

        if (!existing) {
            return apiError('Documentation not found', 404, 'NOT_FOUND');
        }

        await prisma.documentation.delete({
            where: { id: parseInt(id) },
        });
    await auditDelete(userId, 'Documentation', existing);

        const response = apiSuccess({ deleted: true, id: parseInt(id) });
        Object.entries(corsHeaders()).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
        return response;
    }, { requiredScopes: ['delete'] });
}
