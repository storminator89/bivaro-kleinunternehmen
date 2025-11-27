import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogs, getEntityAuditHistory } from '@/lib/audit-log';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/get-user-id';
import { prisma } from '@/lib/prisma';

// GET /api/audit-logs - Get audit logs with filtering
export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId();
    
    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    
    const isAdmin = user?.role === 'ADMIN';
    
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const entityType = url.searchParams.get('entityType') || undefined;
    const entityId = url.searchParams.get('entityId') || undefined;
    const action = url.searchParams.get('action') || undefined;
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const targetUserId = url.searchParams.get('userId');
    
    // Non-admins can only see their own logs
    const filterUserId = isAdmin && targetUserId ? targetUserId : (isAdmin ? undefined : userId);
    
    const result = await getAuditLogs({
      userId: filterUserId,
      entityType: entityType as any,
      entityId,
      action: action as any,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      page,
      pageSize,
    });
    
    // Format logs for response
    const formattedLogs = result.logs.map(log => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      entityName: log.entityName,
      changedFields: log.changedFields ? JSON.parse(log.changedFields) : null,
      oldValues: log.oldValues ? JSON.parse(log.oldValues) : null,
      newValues: log.newValues ? JSON.parse(log.newValues) : null,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
      ipAddress: log.ipAddress,
      createdAt: log.createdAt,
      user: {
        id: log.user.id,
        email: log.user.email,
        name: log.user.name,
      },
    }));
    
    return NextResponse.json({
      logs: formattedLogs,
      pagination: result.pagination,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    console.error('Error fetching audit logs:', error);
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}
