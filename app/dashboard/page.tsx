import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import React from "react";

export default async function DashboardPage() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <main style={{ maxWidth: "800px", margin: "4rem auto", padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Admin Dashboard</h1>
      <p>Authenticated as Admin ID: {session.adminId}</p>
      <div style={{ marginTop: "2rem" }}>
        <p>Welcome to the Discord Bot administration dashboard.</p>
      </div>
    </main>
  );
}
