/**
 * API Route: /api/documentation
 * Manage GoBD Verfahrensdokumentation
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { createEmptyDocumentation, getAppVersion, getSystemInfo } from '@/lib/gobd-template';

// GET: Load current documentation or create default
export async function GET(request: NextRequest) {
    try {
        const userId = await requireUserId();

        // Get the latest documentation for this user
        const doc = await prisma.documentation.findFirst({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
        });

        if (doc) {
            return NextResponse.json({
                id: doc.id,
                version: doc.version,
                title: doc.title,
                content: JSON.parse(doc.content),
                createdAt: doc.createdAt.toISOString(),
                updatedAt: doc.updatedAt.toISOString(),
            });
        }

        // Return empty template if no documentation exists
        const emptyDoc = createEmptyDocumentation();
        return NextResponse.json({
            id: null,
            version: getAppVersion(),
            title: 'Verfahrensdokumentation',
            content: emptyDoc,
            createdAt: null,
            updatedAt: null,
        });
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return unauthorizedResponse();
        }
        console.error('Error loading documentation:', error);
        return NextResponse.json({ error: 'Fehler beim Laden der Dokumentation' }, { status: 500 });
    }
}

// POST: Save documentation
export async function POST(request: NextRequest) {
    try {
        const userId = await requireUserId();
        const body = await request.json();

        const { title, content } = body;

        if (!content) {
            return NextResponse.json({ error: 'Inhalt fehlt' }, { status: 400 });
        }

        // Update systemInfo with current values
        const contentWithSystemInfo = {
            ...content,
            systemInfo: getSystemInfo(),
            updatedAt: new Date().toISOString(),
        };

        // Check if documentation exists
        const existingDoc = await prisma.documentation.findFirst({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
        });

        let doc;
        if (existingDoc) {
            // Update existing
            doc = await prisma.documentation.update({
                where: { id: existingDoc.id },
                data: {
                    version: getAppVersion(),
                    title: title || 'Verfahrensdokumentation',
                    content: JSON.stringify(contentWithSystemInfo),
                },
            });
        } else {
            // Create new
            doc = await prisma.documentation.create({
                data: {
                    version: getAppVersion(),
                    title: title || 'Verfahrensdokumentation',
                    content: JSON.stringify(contentWithSystemInfo),
                    userId,
                },
            });
        }

        return NextResponse.json({
            id: doc.id,
            version: doc.version,
            title: doc.title,
            content: JSON.parse(doc.content),
            createdAt: doc.createdAt.toISOString(),
            updatedAt: doc.updatedAt.toISOString(),
        });
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return unauthorizedResponse();
        }
        console.error('Error saving documentation:', error);
        return NextResponse.json({ error: 'Fehler beim Speichern der Dokumentation' }, { status: 500 });
    }
}

// GET /api/documentation/history - Get version history
export async function PUT(request: NextRequest) {
    try {
        const userId = await requireUserId();

        // Get all documentation versions for this user
        const docs = await prisma.documentation.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                version: true,
                title: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return NextResponse.json(docs);
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return unauthorizedResponse();
        }
        console.error('Error loading documentation history:', error);
        return NextResponse.json({ error: 'Fehler beim Laden des Versionsverlaufs' }, { status: 500 });
    }
}
