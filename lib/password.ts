import bcrypt from "bcrypt";

export const PASSWORD_HASH_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_HASH_COST);
}
