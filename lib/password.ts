import bcrypt from "bcrypt";
import { validatePassword } from "@/lib/password-policy";

export const PASSWORD_HASH_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  const validation = validatePassword(password);
  if (!validation.valid) throw new Error(validation.message);
  return bcrypt.hash(password, PASSWORD_HASH_COST);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
