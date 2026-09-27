"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import React from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Invalid email or password.");
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: "400px", margin: "4rem auto", padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Admin Login</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label htmlFor="email" style={{ display: "block", marginBottom: "0.5rem" }}>Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            style={{ width: "100%", padding: "0.5rem", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label htmlFor="password" style={{ display: "block", marginBottom: "0.5rem" }}>Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            style={{ width: "100%", padding: "0.5rem", boxSizing: "border-box" }}
          />
        </div>
        {error && <div style={{ color: "red", fontSize: "0.9rem" }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{ padding: "0.75rem", background: "#0070f3", color: "white", border: "none", cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>

      <div style={{ marginTop: "2rem", padding: "1rem", border: "1px solid #e0e0e0", borderRadius: "6px", backgroundColor: "#fafafa" }}>
        <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1em" }}>Evaluator Access</h2>
        <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.9em", color: "#555" }}>
          Email: <code style={{ backgroundColor: "#e8e8e8", padding: "0.1rem 0.3rem", borderRadius: "3px" }}>pruthwirajnayak08@gmail.com</code>
        </p>
        <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.9em", color: "#555" }}>
          Password: <code style={{ backgroundColor: "#e8e8e8", padding: "0.1rem 0.3rem", borderRadius: "3px" }}>Abstrabit@1234</code>
        </p>
        <p style={{ margin: 0, fontSize: "0.8em", color: "#888", fontStyle: "italic" }}>
          These credentials are for evaluation of the deployed assessment only.
        </p>
      </div>
    </main>
  );
}
