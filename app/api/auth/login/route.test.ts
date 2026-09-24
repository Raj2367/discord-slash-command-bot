import test from "node:test";
import assert from "node:assert";
import { POST } from "./route";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

test("admin login API route tests", async (t) => {
  const testEmail = "admin@test.com";
  const testPassword = "correctPassword123";
  const hashedPassword = await hashPassword(testPassword);

  const originalFindUnique = prisma.admin.findUnique;

  t.after(() => {
    prisma.admin.findUnique = originalFindUnique;
  });

  await t.test("1. Missing email/password is rejected", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  await t.test("2. Unknown email is rejected with safe authentication failure", async () => {
    // @ts-ignore
    prisma.admin.findUnique = async () => null;

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown@test.com", password: testPassword }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, "Invalid email or password");
  });

  await t.test("3. Incorrect password is rejected", async () => {
    // @ts-ignore
    prisma.admin.findUnique = async () => ({
      id: "admin_123",
      email: testEmail,
      passwordHash: hashedPassword,
      createdAt: new Date(),
    });

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: "wrongPassword" }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, "Invalid email or password");
  });

  await t.test("4. Correct credentials create the session and return success", async () => {
    // @ts-ignore
    prisma.admin.findUnique = async () => ({
      id: "admin_123",
      email: testEmail,
      passwordHash: hashedPassword,
      createdAt: new Date(),
    });

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    // 5. Successful response does not expose passwordHash or other secrets
    assert.strictEqual("passwordHash" in data, false);
    assert.strictEqual("admin" in data, false);
    assert.strictEqual("token" in data, false);
  });
});
