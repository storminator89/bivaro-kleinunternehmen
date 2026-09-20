import { describe, expect, it } from "vitest";
import bcrypt from "bcrypt";
import { validatePassword } from "@/lib/password-policy";
import { hashPassword, verifyPassword, PASSWORD_HASH_COST } from "@/lib/password";

describe("new password byte policy and legacy hashes", () => {
  it.each([
    ["Aa1" + "x".repeat(69), true],
    ["Aa1" + "x".repeat(70), false],
    ["Aa1" + "ä".repeat(34) + "x", true],
    ["Aa1" + "ä".repeat(35), false],
    ["Aa1" + "😀".repeat(17) + "x", true],
    ["Aa1" + "😀".repeat(18), false],
  ])("checks UTF-8 boundaries: %s", (password, valid) => {
    expect(validatePassword(password).valid).toBe(valid);
  });

  it("rejects both suffix variants sharing a 72-byte prefix at the hashing boundary", async () => {
    const prefix = "Aa1" + "x".repeat(69);
    await expect(hashPassword(prefix + "A")).rejects.toThrow("72 UTF-8-Bytes");
    await expect(hashPassword(prefix + "B")).rejects.toThrow("72 UTF-8-Bytes");
    const hash = await hashPassword(prefix);
    expect(bcrypt.getRounds(hash)).toBe(PASSWORD_HASH_COST);
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(await verifyPassword(prefix, hash)).toBe(true);
    expect(await verifyPassword("Ba1" + "x".repeat(69), hash)).toBe(false);
  });

  it("still verifies a pre-policy bcrypt hash without applying new-password rejection", async () => {
    // Synthetic historic hash of Aa1 + 80 x characters, generated before the policy.
    const hash = "$2b$12$0xuStSt.gnLYd16pJNH/oevZW1d1sQL9KX.cLTYRaxHx/Xi8mg9nK";
    const legacyPassword = "Aa1" + "x".repeat(80);
    expect(validatePassword(legacyPassword).valid).toBe(false);
    expect(await verifyPassword(legacyPassword, hash)).toBe(true);
    expect(await verifyPassword(legacyPassword, hash.replace("$2b$", "$2a$"))).toBe(true);
  });
});
