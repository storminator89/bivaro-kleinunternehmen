import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  
  // Protected routes - require authentication
  const protectedPaths = ['/dashboard'];
  
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
  
  return NextResponse.next();
}

// Match specific paths for the middleware to run on
export const config = {
  matcher: ['/', '/login', '/register', '/dashboard/:path*'],
};