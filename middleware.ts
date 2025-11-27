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

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  
  // Protected routes - require authentication
  const protectedPaths = ['/dashboard', '/steuer-simulation', '/users', '/customers', '/settings'];
  
  // Extract the path from the request URL
  const path = request.nextUrl.pathname;

  // Check if the current path is a protected route
  const isProtectedPath = protectedPaths.some(protectedPath => 
    path === protectedPath || path.startsWith(`${protectedPath}/`)
  );

  // If it's a protected route and user is not authenticated, redirect to login
  if (isProtectedPath && !token) {
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
  
  // Add security headers to all responses
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
}

// Match specific paths for the middleware to run on
export const config = {
  matcher: ['/', '/login', '/register', '/dashboard/:path*', '/steuer-simulation/:path*', '/users/:path*', '/customers/:path*', '/settings/:path*'],
};
