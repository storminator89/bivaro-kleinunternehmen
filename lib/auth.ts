import { NextAuthOptions } from "next-auth";
import type { Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { auditSecurityEvent, createAuditLog } from "@/lib/audit-log";
import {
  consumeRateLimit,
  getTrustedClientIp,
  resetRateLimit,
} from "@/lib/rate-limit";

export const VALID_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof VALID_ROLES)[number];

export function isValidRole(role: unknown): role is UserRole {
  return typeof role === "string" && VALID_ROLES.includes(role as UserRole);
}

export const LOGIN_ACCOUNT_RATE_LIMIT = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 30 * 60 * 1000,
};

// Without an explicitly trusted proxy all callers share the fallback IP key.
// Keep that coarse safety net high enough for a small office while the account
// bucket above remains the strict brute-force control.
export const LOGIN_IP_RATE_LIMIT = {
  limit: 100,
  windowMs: 15 * 60 * 1000,
  blockMs: 5 * 60 * 1000,
};

// Backwards-compatible name for callers that only need the account policy.
export const LOGIN_RATE_LIMIT = LOGIN_ACCOUNT_RATE_LIMIT;

function withoutUser(session: Session) {
  const { user: _user, ...sessionWithoutUser } = session;
  return sessionWithoutUser;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (
          typeof credentials?.email !== "string" ||
          typeof credentials?.password !== "string" ||
          !credentials.email ||
          !credentials.password
        ) return null;

        const email = credentials.email.trim().toLowerCase();
        const clientIp = getTrustedClientIp(request.headers);
        const accountKey = `login:email:${email}`;
        const ipKey = `login:ip:${clientIp}`;

        // These buckets are shared by all workers using the same database.
        // Consume both dimensions before looking up the account to avoid
        // turning login responses into an account-enumeration oracle.
        const accountLimit = await consumeRateLimit(accountKey, LOGIN_ACCOUNT_RATE_LIMIT);
        const ipLimit = await consumeRateLimit(ipKey, LOGIN_IP_RATE_LIMIT);
        if (!accountLimit.allowed || !ipLimit.allowed) {
          const blockedUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true },
          });
          if (blockedUser) {
            await auditSecurityEvent(blockedUser.id, {
              event: "AUTH_LOGIN_RATE_LIMITED",
              outcome: "blocked",
              severity: "warning",
              metadata: {
                accountRemaining: accountLimit.remaining,
                ipRemaining: ipLimit.remaining,
              },
            });
          }
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            password: true,
            role: true,
            sessionVersion: true,
            deactivatedAt: true,
          },
        });

        if (!user || user.deactivatedAt || !isValidRole(user.role)) return null;

        const isPasswordValid = await verifyPassword(credentials.password, user.password);
        if (!isPasswordValid) {
          try {
            await createAuditLog({
              userId: user.id,
              action: "LOGIN_FAILED",
              entityType: "User",
              entityId: user.id,
              entityName: user.email,
              metadata: {
                reason: "Invalid password",
                remainingAttempts: Math.min(accountLimit.remaining, ipLimit.remaining),
              },
            });
            await auditSecurityEvent(user.id, {
              event: "AUTH_LOGIN_FAILED",
              outcome: "failure",
              severity: "info",
              metadata: { reason: "Invalid password" },
            });
          } catch (error) {
            console.error("Failed to log login attempt:", error);
          }
          return null;
        }

        // A valid login resets only this account's failure bucket.  Resetting
        // the shared IP bucket would let an attacker use any valid account to
        // erase the IP's brute-force history.
        await resetRateLimit(accountKey);

        try {
          await createAuditLog({
            userId: user.id,
            action: "LOGIN",
            entityType: "User",
            entityId: user.id,
            entityName: user.email,
          });
          await auditSecurityEvent(user.id, {
            event: "AUTH_LOGIN",
            outcome: "success",
            severity: "info",
          });
        } catch (error) {
          console.error("Failed to log login:", error);
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const userId =
        (typeof user?.id === "string" && user.id) ||
        (typeof token.id === "string" && token.id) ||
        (typeof token.sub === "string" && token.sub);

      if (!userId) return { ...token, revoked: true };

      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          sessionVersion: true,
          deactivatedAt: true,
        },
      });

      if (!currentUser || currentUser.deactivatedAt || !isValidRole(currentUser.role)) {
        return { ...token, revoked: true };
      }

      const previousSessionVersion =
        typeof token.sessionVersion === "number" ? token.sessionVersion : undefined;

      // On sign-in, initialize the token generation. On subsequent reads, a
      // changed generation means password reset, role change, or account lock
      // and permanently invalidates this cookie.
      if (
        !user &&
        (token.revoked ||
          (previousSessionVersion === undefined ||
            previousSessionVersion !== currentUser.sessionVersion))
      ) {
        return { ...token, revoked: true };
      }

      token.id = currentUser.id;
      token.sub = currentUser.id;
      token.email = currentUser.email;
      token.name = currentUser.name;
      token.role = currentUser.role;
      token.sessionVersion = currentUser.sessionVersion;
      token.revoked = false;
      return token;
    },
    async session({ session, token }) {
      if (
        token.revoked ||
        typeof token.id !== "string" ||
        !isValidRole(token.role) ||
        typeof token.sessionVersion !== "number"
      ) {
        // NextAuth's callback type does not expose null here, but omitting the
        // user makes getServerSession and every central auth helper reject the
        // cookie immediately.
        return withoutUser(session) as typeof session;
      }

      session.user = {
        ...session.user,
        id: token.id,
        role: token.role,
        sessionVersion: token.sessionVersion,
        email: token.email || null,
        name: token.name || null,
      };
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
};
