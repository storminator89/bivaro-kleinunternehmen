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
  }) => Promise<NextResponse | Response>,
  options?: {
    requiredScopes?: string[];
  }
): Promise<NextResponse | Response> {
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
  let response: NextResponse | Response;
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

  // Add user-specific CORS headers
  const userCorsHeaders = await corsHeadersForUser(request, validation.userId);
  Object.entries(userCorsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

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
 * Default allowed origins (always allowed)
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://localhost:3000',
];

/**
 * Cache for user-specific CORS origins (to avoid DB lookups on every request)
 * Key: userId, Value: { origins: string[], expiresAt: number }
 */
const corsOriginsCache = new Map<string, { origins: string[]; expiresAt: number }>();
const CORS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get allowed CORS origins for a user from database (with caching)
 */
export async function getAllowedOriginsForUser(userId: string): Promise<string[]> {
  // Check cache first
  const cached = corsOriginsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return [...DEFAULT_ALLOWED_ORIGINS, ...cached.origins];
  }

  try {
    const settings = await prisma.settings.findUnique({
      where: { userId },
      select: { allowedOrigins: true },
    });

    let userOrigins: string[] = [];
    if (settings?.allowedOrigins) {
      try {
        userOrigins = JSON.parse(settings.allowedOrigins);
        if (!Array.isArray(userOrigins)) {
          userOrigins = [];
        }
      } catch {
        userOrigins = [];
      }
    }

    // Update cache
    corsOriginsCache.set(userId, {
      origins: userOrigins,
      expiresAt: Date.now() + CORS_CACHE_TTL_MS,
    });

    return [...DEFAULT_ALLOWED_ORIGINS, ...userOrigins];
  } catch (error) {
    console.error('Error fetching allowed origins:', error);
    return DEFAULT_ALLOWED_ORIGINS;
  }
}

/**
 * Clear CORS cache for a user (call when origins are updated)
 */
export function clearCorsCache(userId: string): void {
  corsOriginsCache.delete(userId);
}

/**
 * CORS headers for API responses (synchronous, for unauthenticated requests)
 * For authenticated requests, use corsHeadersForUser
 */
export function corsHeaders(request?: NextRequest): HeadersInit {
  let origin = '';
  if (request) {
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin && DEFAULT_ALLOWED_ORIGINS.includes(requestOrigin)) {
      origin = requestOrigin;
    } else if (process.env.NODE_ENV !== 'production') {
      // In development, be more permissive for unauthenticated CORS preflight
      origin = requestOrigin || '*';
    }
  }
  
  return {
    'Access-Control-Allow-Origin': origin || (process.env.NODE_ENV === 'production' ? '' : '*'),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * CORS headers for authenticated API responses (async, checks user-specific origins)
 */
export async function corsHeadersForUser(request: NextRequest, userId: string): Promise<HeadersInit> {
  const requestOrigin = request.headers.get('origin');
  let allowedOrigin = '';

  if (requestOrigin) {
    const allowedOrigins = await getAllowedOriginsForUser(userId);
    if (allowedOrigins.includes(requestOrigin)) {
      allowedOrigin = requestOrigin;
    } else if (process.env.NODE_ENV !== 'production') {
      // In development, allow all origins
      allowedOrigin = requestOrigin;
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin || '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
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
