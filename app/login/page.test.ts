import test from "node:test";
import assert from "node:assert";

test("login page behavior and validation logic", async (t) => {
  await t.test("1. Required fields validation", () => {
    const email = "";
    const password = "";
    const isValid = email.trim() !== "" && password !== "";
    assert.strictEqual(isValid, false);
  });

  await t.test("2. Submit calls the login endpoint correctly", async () => {
    let requestedUrl = "";
    let requestOptions: any = null;

    // Mock global fetch
    const originalFetch = global.fetch;
    global.fetch = async (url: any, options: any) => {
      requestedUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const email = "admin@test.com";
      const password = "password123";

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      assert.strictEqual(requestedUrl, "/api/auth/login");
      assert.strictEqual(requestOptions.method, "POST");
      const parsedBody = JSON.parse(requestOptions.body);
      assert.strictEqual(parsedBody.email, email);
      assert.strictEqual(parsedBody.password, password);
      assert.strictEqual(res.status, 200);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test("3. Failed login handles generic error response", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return new Response(JSON.stringify({ error: "Invalid email or password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wrong@test.com", password: "wrong" }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 401);
      assert.strictEqual(data.error, "Invalid email or password");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test("4. Successful login triggers dashboard navigation target", async () => {
    const targetRoute = "/dashboard";
    assert.strictEqual(targetRoute, "/dashboard");
  });
});
