"use client";

import React, { useEffect, useState } from "react";

export interface ActionRecord {
  id: string;
  type: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface InteractionLog {
  id: string;
  interactionId: string;
  guildId: string;
  channelId: string;
  userId: string;
  username: string;
  commandName: string;
  status: string;
  createdAt: string;
  processedAt: string | null;
  actions: ActionRecord[];
}

export interface DashboardData {
  interactions: InteractionLog[];
}

const POLL_INTERVAL_MS = 5000;

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDashboardData() {
      try {
        const res = await fetch("/api/dashboard/data");
        if (!res.ok) {
          throw new Error(`API returned status ${res.status}`);
        }
        const json: DashboardData = await res.json();
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load dashboard data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchDashboardData();

    const interval = setInterval(fetchDashboardData, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error && !data) {
    return (
      <main style={{ maxWidth: "800px", margin: "4rem auto", padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Admin Dashboard</h1>
        <p style={{ color: "red" }}>{error}</p>
      </main>
    );
  }

  if (loading || !data) {
    return (
      <main style={{ maxWidth: "800px", margin: "4rem auto", padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Admin Dashboard</h1>
        <p>Loading interactions...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: "800px", margin: "4rem auto", padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Admin Dashboard</h1>
      <p>Last updated: {new Date().toLocaleTimeString()}</p>

      {data.interactions.length === 0 ? (
        <p>No interactions found.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem 0" }}>Command</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem 0" }}>User</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem 0" }}>Time</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem 0" }}>Status</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem 0" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.interactions.map((interaction) => (
              <tr key={interaction.id}>
                <td style={{ padding: "0.5rem 0" }}>{interaction.commandName}</td>
                <td style={{ padding: "0.5rem 0" }}>{interaction.username}</td>
                <td style={{ padding: "0.5rem 0" }}>
                  {new Date(interaction.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: "0.5rem 0" }}>{interaction.status}</td>
                <td style={{ padding: "0.5rem 0" }}>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {interaction.actions.map((action) => (
                       <li key={action.id} style={{ marginBottom: "0.25rem" }}>
                         <span style={{ textTransform: "uppercase", fontSize: "0.8em" }}>{action.type}</span>
                         {" — "}
                         <span>{action.status}</span>
                         {" (attempts: "}{action.attempts}{")"}
                         {" — completed: "}
                         {action.completedAt
                           ? new Date(action.completedAt).toLocaleString()
                           : "—"}
                         {action.lastError && (
                           <span style={{ color: "red", marginLeft: "0.5rem" }}>
                             — {action.lastError}
                           </span>
                         )}
                       </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && (
        <p style={{ color: "orange", marginTop: "1rem" }}>{error}</p>
      )}
    </main>
  );
}
