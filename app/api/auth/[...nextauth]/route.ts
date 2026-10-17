import NextAuth from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { protectMutation, MAX_AUTH_BODY_BYTES } from '@/lib/request-security';

const handler = NextAuth(authOptions);
export { handler as GET };
export const POST = protectMutation(handler, { nextAuth: true, maxBodyBytes: MAX_AUTH_BODY_BYTES });
