import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Security headers to add to all responses
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// Protected routes that require authentication
const protectedPaths = ['/dashboard', '/steuer-simulation', '/users', '/customers', '/settings'];

// Check if a path matches any protected route
function isProtectedRoute(path: string): boolean {
  return protectedPaths.some(protectedPath => 
    path === protectedPath || path.startsWith(`${protectedPath}/`)
  );
}

// Add security headers to response
function addSecurityHeaders(response: NextResponse): NextResponse {
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const path = request.nextUrl.pathname;

  // If it's a protected route and user is not authenticated, redirect to login
  if (isProtectedRoute(path) && !token) {
    const url = new URL('/login', request.url);
    url.searchParams.set('callbackUrl', encodeURI(request.url));
    return NextResponse.redirect(url);
  }
  
  // If user is already authenticated and trying to access login/register, redirect to dashboard
  if ((path === '/login' || path === '/register') && token) {
    const url = new URL('/dashboard', request.url);
    return NextResponse.redirect(url);
  }
  
  // Create response with security headers
  const response = NextResponse.next();
  return addSecurityHeaders(response);
}

// Routes to match
export const routes = [
  '/',
  '/login',
  '/register',
  '/dashboard/:path*',
  '/steuer-simulation/:path*',
  '/users/:path*',
  '/customers/:path*',
  '/settings/:path*',
];
