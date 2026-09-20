import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDatabase } from "./helpers/database";

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createTestDatabase>["client"] | null }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.client; } }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "admin", role: "ADMIN", sessionVersion: 0 }, expires: "2099-01-01" }) }));
import { POST as register } from "@/app/api/auth/register/route";
import { POST as createUser } from "@/app/api/users/route";
import { PATCH as updateUser } from "@/app/api/users/[id]/route";

let fixture: ReturnType<typeof createTestDatabase>;
beforeAll(async () => {
  fixture = createTestDatabase();
  state.client = fixture.client;
  await fixture.client.user.createMany({ data: [
    { id: "admin", email: "admin@test.invalid", password: "unchanged", role: "ADMIN" },
    { id: "target", email: "target@test.invalid", password: "unchanged", role: "USER" },
  ] });
}, 40_000);
afterAll(async () => { await fixture?.cleanup(); });

it("rejects excess UTF-8 bytes in registration, admin creation and password reset without writes", async () => {
  const password = "Aa1" + "😀".repeat(18);
  const data = { email: "new@test.invalid", password, name: "Test" };
  const request = (url: string, method = "POST") => new NextRequest(`http://localhost${url}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(data),
  });
  for (const response of [
    await register(request("/api/auth/register")),
    await createUser(request("/api/users")),
    await updateUser(request("/api/users/target", "PATCH"), { params: Promise.resolve({ id: "target" }) }),
  ]) {
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("72 UTF-8-Bytes");
  }
  expect(await fixture.client.user.count()).toBe(2);
  const target = await fixture.client.user.findUniqueOrThrow({ where: { id: "target" } });
  expect(target.password).toBe("unchanged");
  expect(target.sessionVersion).toBe(0);
});
