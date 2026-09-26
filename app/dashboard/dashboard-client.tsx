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
const STALE_PENDING_MS = 2 * 60 * 1000;

function isRetryEligible(action: ActionRecord): boolean {
  if (action.type === "DISCORD_RESPONSE") {
    return false;
  }
  if (action.status === "FAILED") {
    return true;
  }
  if (action.status === "PENDING") {
    return Date.now() - new Date(action.updatedAt).getTime() > STALE_PENDING_MS;
  }
  return false;
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingActionId, setRetryingActionId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch("/api/dashboard/data");
      if (!res.ok) {
        throw new Error(`API returned status ${res.status}`);
      }
      const json: DashboardData = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (actionId: string) => {
    setRetryingActionId(actionId);
    setRetryError(null);
    try {
      const res = await fetch("/api/admin/actions/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ actionId }),
      });

      if (res.ok) {
        await fetchDashboardData();
      } else if (res.status === 409) {
        setRetryError("Action is no longer eligible for retry.");
        await fetchDashboardData();
      } else if (res.status === 401) {
        setRetryError("Authentication required. Please log in again.");
      } else {
        setRetryError("Retry failed.");
      }
    } catch {
      setRetryError("Retry failed.");
    } finally {
      setRetryingActionId(null);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
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

      {retryError && (
        <p style={{ color: "orange", marginTop: "1rem" }}>{retryError}</p>
      )}

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
                        {isRetryEligible(action) && (
                          <button
                            onClick={() => handleRetry(action.id)}
                            disabled={retryingActionId === action.id}
                            style={{ marginLeft: "0.5rem", fontSize: "0.8em" }}
                          >
                            {retryingActionId === action.id ? "Retrying..." : "Retry"}
                          </button>
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
    </main>
  );
}
