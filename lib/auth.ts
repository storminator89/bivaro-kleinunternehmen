import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createAuditLog } from "@/lib/audit-log";

// Login rate limiting
const loginAttempts = new Map<string, { count: number; resetTime: number; blocked: boolean }>();
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes block after max attempts

function checkLoginRateLimit(email: string): { allowed: boolean; remainingAttempts: number } {
  const now = Date.now();
  const key = email.toLowerCase();
  const record = loginAttempts.get(key);
  
  if (!record || now > record.resetTime) {
    loginAttempts.set(key, { count: 1, resetTime: now + LOGIN_RATE_LIMIT_WINDOW_MS, blocked: false });
    return { allowed: true, remainingAttempts: MAX_LOGIN_ATTEMPTS - 1 };
  }
  
  if (record.blocked && now < record.resetTime) {
    return { allowed: false, remainingAttempts: 0 };
  }
  
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.blocked = true;
    record.resetTime = now + BLOCK_DURATION_MS;
    return { allowed: false, remainingAttempts: 0 };
  }
  
  record.count++;
  return { allowed: true, remainingAttempts: MAX_LOGIN_ATTEMPTS - record.count };
}

function resetLoginAttempts(email: string): void {
  loginAttempts.delete(email.toLowerCase());
}

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                // Check rate limit
                const rateLimit = checkLoginRateLimit(credentials.email);
                if (!rateLimit.allowed) {
                    // Log blocked attempt
                    console.warn(`Login blocked for ${credentials.email} due to rate limiting`);
                    return null;
                }

                const user = await prisma.user.findUnique({
                    where: { email: credentials.email.toLowerCase() }
                });

                if (!user) {
                    // Log failed attempt (user not found)
                    return null;
                }

                const isPasswordValid = await bcrypt.compare(
                    credentials.password,
                    user.password
                );

                if (!isPasswordValid) {
                    // Log failed attempt (wrong password)
                    try {
                        await createAuditLog({
                            userId: user.id,
                            action: 'LOGIN_FAILED',
                            entityType: 'User',
                            entityId: user.id,
                            entityName: user.email,
                            metadata: { reason: 'Invalid password', remainingAttempts: rateLimit.remainingAttempts },
                        });
                    } catch (e) {
                        console.error('Failed to log login attempt:', e);
                    }
                    return null;
                }

                // Successful login - reset rate limit
                resetLoginAttempts(credentials.email);

                // Log successful login
                try {
                    await createAuditLog({
                        userId: user.id,
                        action: 'LOGIN',
                        entityType: 'User',
                        entityId: user.id,
                        entityName: user.email,
                    });
                } catch (e) {
                    console.error('Failed to log login:', e);
                }

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                };
            }
        })
    ],
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
                token.role = (user as any).role;
            }
            return token;
        },
        async session({ session, token }) {
            if (token) {
                // token.sub enthält die User-ID, token.id könnte undefined sein
                session.user.id = (token.id || token.sub) as string;
                session.user.role = token.role as string;
            }
            return session;
        }
    },
    session: {
        strategy: "jwt",
        maxAge: 24 * 60 * 60, // 24 hours
    },
    secret: process.env.NEXTAUTH_SECRET,
    pages: {
        signIn: "/login",
    },
};