/**
 * API Authentication & Security Module
 * 
 * Provides secure API key authentication, rate limiting, and audit logging
 * for the external REST API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // max requests per window

// In-memory rate limit store (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key
 * Returns: { key: string (plain), keyHash: string (for storage), keyPrefix: string (for display) }
 */
export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  // Generate a secure random key: biv_sk_<random>
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `biv_sk_${randomBytes}`;
  const keyHash = hashApiKey(key);
  const keyPrefix = key.substring(0, 12) + '...';
  
  return { key, keyHash, keyPrefix };
}

/**
 * Validate an API key and return the associated user
 */
export async function validateApiKey(apiKey: string): Promise<{
  valid: boolean;
  userId?: string;
  apiKeyId?: number;
  scopes?: string[];
  error?: string;
}> {
  if (!apiKey || !apiKey.startsWith('biv_sk_')) {
    return { valid: false, error: 'Invalid API key format' };
  }

  const keyHash = hashApiKey(apiKey);

  try {
    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    });

    if (!apiKeyRecord) {
      return { valid: false, error: 'API key not found' };
    }

    if (!apiKeyRecord.isActive) {
      return { valid: false, error: 'API key is deactivated' };
    }

    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
      return { valid: false, error: 'API key has expired' };
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      valid: true,
      userId: apiKeyRecord.userId,
      apiKeyId: apiKeyRecord.id,
      scopes: apiKeyRecord.scopes ? JSON.parse(apiKeyRecord.scopes) : ['read', 'write'],
    };
  } catch (error) {
    console.error('Error validating API key:', error);
    return { valid: false, error: 'Internal validation error' };
  }
}

/**
 * Check rate limit for an API key
 */
export function checkRateLimit(apiKeyId: number): {
  allowed: boolean;
  remaining: number;
  resetTime: number;
} {
  const now = Date.now();
  const key = `api_key_${apiKeyId}`;
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    // Reset or initialize
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime,
    };
  }

  record.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - record.count,
    resetTime: record.resetTime,
  };
}

/**
 * Log API access for audit purposes
 */
export async function logApiAccess(params: {
  apiKeyId: number;
  userId: string;
  method: string;
  endpoint: string;
  statusCode: number;
  ipAddress?: string;
  userAgent?: string;
  requestBody?: string;
  responseTime?: number;
}): Promise<void> {
  try {
    await prisma.apiLog.create({
      data: {
        apiKeyId: params.apiKeyId,
        userId: params.userId,
        method: params.method,
        endpoint: params.endpoint,
        statusCode: params.statusCode,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
        requestBody: params.requestBody || null,
        responseTime: params.responseTime || null,
      },
    });
  } catch (error) {
    console.error('Error logging API access:', error);
  }
}

/**
 * API Response helpers
 */
export function apiError(
  message: string,
  statusCode: number = 400,
  code?: string
): NextResponse {
  return NextResponse.json(
    {
      error: {
        message,
        code: code || `ERR_${statusCode}`,
        timestamp: new Date().toISOString(),
      },
    },
    { status: statusCode }
  );
}

export function apiSuccess<T>(
  data: T,
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    hasMore?: boolean;
  }
): NextResponse {
  const response: any = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };

  if (meta) {
    response.meta = meta;
  }

  return NextResponse.json(response);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request: NextRequest): string | null {
  // Check Authorization header: Bearer <key>
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check X-API-Key header
  const apiKeyHeader = request.headers.get('x-api-key');
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  return null;
}

/**
 * API authentication middleware wrapper
 */
export async function withApiAuth(
  request: NextRequest,
  handler: (params: {
    userId: string;
    apiKeyId: number;
    scopes: string[];
  }) => Promise<NextResponse>,
  options?: {
    requiredScopes?: string[];
  }
): Promise<NextResponse> {
  const startTime = Date.now();
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    return apiError('Missing API key. Use Authorization: Bearer <key> or X-API-Key header', 401, 'MISSING_API_KEY');
  }

  // Validate API key
  const validation = await validateApiKey(apiKey);
  if (!validation.valid || !validation.userId || !validation.apiKeyId) {
    return apiError(validation.error || 'Invalid API key', 401, 'INVALID_API_KEY');
  }

  // Check rate limit
  const rateLimit = checkRateLimit(validation.apiKeyId);
  if (!rateLimit.allowed) {
    const response = apiError('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
    response.headers.set('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS.toString());
    response.headers.set('X-RateLimit-Remaining', '0');
    response.headers.set('X-RateLimit-Reset', Math.ceil(rateLimit.resetTime / 1000).toString());
    return response;
  }

  // Check scopes
  if (options?.requiredScopes) {
    const hasRequiredScopes = options.requiredScopes.every(
      (scope) => validation.scopes?.includes(scope) || validation.scopes?.includes('*')
    );
    if (!hasRequiredScopes) {
      return apiError('Insufficient permissions', 403, 'INSUFFICIENT_SCOPES');
    }
  }

  // Execute handler
  let response: NextResponse;
  try {
    response = await handler({
      userId: validation.userId,
      apiKeyId: validation.apiKeyId,
      scopes: validation.scopes || [],
    });
  } catch (error) {
    console.error('API handler error:', error);
    response = apiError('Internal server error', 500, 'INTERNAL_ERROR');
  }

  // Add rate limit headers
  response.headers.set('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS.toString());
  response.headers.set('X-RateLimit-Remaining', rateLimit.remaining.toString());
  response.headers.set('X-RateLimit-Reset', Math.ceil(rateLimit.resetTime / 1000).toString());

  // Log API access
  const responseTime = Date.now() - startTime;
  await logApiAccess({
    apiKeyId: validation.apiKeyId,
    userId: validation.userId,
    method: request.method,
    endpoint: new URL(request.url).pathname,
    statusCode: response.status,
    ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
    responseTime,
  });

  return response;
}

/**
 * CORS headers for API responses
 */
export function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Handle OPTIONS request for CORS
 */
export function handleCors(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}
