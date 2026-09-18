import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";

/**
 * Public, unauthenticated page routes.
 * Everything else matched by `config.matcher` requires a valid session.
 *
 * Note: API routes are intentionally NOT matched here. They authenticate
 * per-request inside their handlers via `requireUserId()` / `getServerSession()`.
 * Security headers are applied globally via `next.config.ts`.
 */
const PUBLIC_PATHS = new Set<string>(["/", "/login", "/register"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Legacy documents may still exist in public/uploads after an upgrade.
  // Never let Next.js serve those files through its unauthenticated static path.
  if (pathname === '/uploads' || pathname.startsWith('/uploads/')) {
    return new NextResponse(null, { status: 404 });
  }

  let token: unknown = null;
  try {
    token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
  } catch (error) {
    // A failed JWT decryption (e.g. after rotating NEXTAUTH_SECRET) must not
    // crash the request; treat the user as unauthenticated.
    console.error("[proxy] JWT decryption failed:", error);
  }

  const tokenRecord = token as {
    id?: unknown;
    sub?: unknown;
    role?: unknown;
    sessionVersion?: unknown;
    revoked?: unknown;
  } | null;
  let isAuthenticated = false;
  const tokenUserId =
    typeof tokenRecord?.id === "string"
      ? tokenRecord.id
      : typeof tokenRecord?.sub === "string"
        ? tokenRecord.sub
        : null;

  if (
    tokenRecord &&
    tokenUserId &&
    !tokenRecord.revoked &&
    (tokenRecord.role === "USER" || tokenRecord.role === "ADMIN") &&
    typeof tokenRecord.sessionVersion === "number"
  ) {
    try {
      const currentUser = await prisma.user.findUnique({
        where: { id: tokenUserId },
        select: { role: true, sessionVersion: true },
      });
      isAuthenticated = Boolean(
        currentUser &&
          (currentUser.role === "USER" || currentUser.role === "ADMIN") &&
          currentUser.role === tokenRecord.role &&
          currentUser.sessionVersion === tokenRecord.sessionVersion,
      );
    } catch (error) {
      // Fail closed when the revocation lookup cannot be completed.
      console.error("[proxy] session validation failed:", error);
    }
  }

  // Authenticated users on /login or /register go straight to the dashboard.
  if (isAuthenticated && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Unauthenticated users on a protected page get redirected to /login,
  // preserving the originally requested path as `callbackUrl`.
  if (!isAuthenticated && !PUBLIC_PATHS.has(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Match all page routes except:
   *  - /api/*           (API auth is handled per route)
   *  - /_next/static/*  (build assets)
   *  - /_next/image*    (image optimizer)
   *  - favicon.ico
   *  - anything containing a dot (static files like .png, .css, .js, .map, …)
   */
  matcher: ["/uploads/:path*", "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
