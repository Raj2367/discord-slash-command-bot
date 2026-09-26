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

export interface CommandRuleConfig {
  id: string;
  commandName: string;
  enabled: boolean;
  responseText: string;
  mirrorEnabled: boolean;
  channelPostEnabled: boolean;
  aiEnabled: boolean;
  updatedAt: string;
}

export interface ServerConfig {
  id: string;
  guildId: string;
  guildName: string;
  channelId: string | null;
  mirrorType: string | null;
  mirrorWebhookConfigured: boolean;
}

export interface AdminConfigData {
  commandRules: CommandRuleConfig[];
  serverConfig: ServerConfig | null;
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
  const [config, setConfig] = useState<AdminConfigData | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [ruleSuccess, setRuleSuccess] = useState<string | null>(null);

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

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/admin/config");
      if (!res.ok) {
        throw new Error(`API returned status ${res.status}`);
      }
      const json: AdminConfigData = await res.json();
      setConfig(json);
      setConfigError(null);
    } catch (err) {
      setConfigError("Failed to load configuration");
    } finally {
      setConfigLoading(false);
    }
  };

  const handleSaveCommand = async (rule: CommandRuleConfig) => {
    setSavingRuleId(rule.id);
    setRuleError(null);
    setRuleSuccess(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          type: "command",
          id: rule.id,
          enabled: rule.enabled,
          responseText: rule.responseText,
          mirrorEnabled: rule.mirrorEnabled,
          channelPostEnabled: rule.channelPostEnabled,
          aiEnabled: rule.aiEnabled,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const updatedRule = data.commandRule;
        setConfig((prev) =>
          prev
            ? {
                ...prev,
                commandRules: prev.commandRules.map((r) =>
                  r.id === updatedRule.id ? updatedRule : r
                ),
              }
            : prev
        );
        setRuleSuccess("Saved.");
      } else {
        setRuleError("Failed to save.");
      }
    } catch {
      setRuleError("Failed to save.");
    } finally {
      setSavingRuleId(null);
    }
  };

  const toggleCheckbox = (rule: CommandRuleConfig, field: keyof Pick<CommandRuleConfig, "enabled" | "mirrorEnabled" | "channelPostEnabled" | "aiEnabled">) => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            commandRules: prev.commandRules.map((r) =>
              r.id === rule.id ? { ...r, [field]: !r[field] } : r
            ),
          }
        : prev
    );
  };

  const updateResponseText = (rule: CommandRuleConfig, value: string) => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            commandRules: prev.commandRules.map((r) =>
              r.id === rule.id ? { ...r, responseText: value } : r
            ),
          }
        : prev
    );
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
    fetchConfig();
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

      {configLoading ? (
        <p>Loading configuration...</p>
      ) : configError ? (
        <p style={{ color: "red" }}>{configError}</p>
      ) : config ? (
        <div style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.2em", marginBottom: "0.5rem" }}>Command Configuration</h2>
          {ruleError && (
            <p style={{ color: "red" }}>{ruleError}</p>
          )}
          {ruleSuccess && (
            <p style={{ color: "green" }}>{ruleSuccess}</p>
          )}
          {config.commandRules.map((rule) => {
            const saving = savingRuleId === rule.id;
            return (
              <div key={rule.id} style={{ marginBottom: "1rem", padding: "0.5rem", border: "1px solid #ddd", borderRadius: "4px" }}>
                <strong>{rule.commandName}</strong>
                <div style={{ marginTop: "0.5rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem" }}>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => toggleCheckbox(rule, "enabled")}
                      disabled={saving}
                    />{" Enabled"}
                  </label>
                  <label style={{ display: "block", marginBottom: "0.25rem" }}>
                    <input
                      type="checkbox"
                      checked={rule.mirrorEnabled}
                      onChange={() => toggleCheckbox(rule, "mirrorEnabled")}
                      disabled={saving}
                    />{" Mirror"}
                  </label>
                  <label style={{ display: "block", marginBottom: "0.25rem" }}>
                    <input
                      type="checkbox"
                      checked={rule.channelPostEnabled}
                      onChange={() => toggleCheckbox(rule, "channelPostEnabled")}
                      disabled={saving}
                    />{" Channel Post"}
                  </label>
                  <label style={{ display: "block", marginBottom: "0.25rem" }}>
                    <input
                      type="checkbox"
                      checked={rule.aiEnabled}
                      onChange={() => toggleCheckbox(rule, "aiEnabled")}
                      disabled={saving}
                    />{" AI"}
                  </label>
                  <div style={{ marginBottom: "0.25rem" }}>
                    <textarea
                      value={rule.responseText}
                      onChange={(e) => updateResponseText(rule, e.target.value)}
                      disabled={saving}
                      rows={3}
                      style={{ width: "100%", maxWidth: "400px" }}
                    />
                  </div>
                  <div style={{ marginBottom: "0.25rem", fontSize: "0.8em", color: "#666" }}>
                    Updated: {new Date(rule.updatedAt).toLocaleString()}
                  </div>
                  <button
                    onClick={() => handleSaveCommand(rule)}
                    disabled={saving}
                    style={{ fontSize: "0.8em" }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {config && config.serverConfig ? (
        <div style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.2em", marginBottom: "0.5rem" }}>Server Configuration</h2>
          <div style={{ padding: "0.5rem", border: "1px solid #ddd", borderRadius: "4px" }}>
            <ul style={{ listStyle: "none", padding: "0.25rem 0", margin: 0 }}>
              <li>Guild: {config.serverConfig.guildName}</li>
              <li>Guild ID: {config.serverConfig.guildId}</li>
              <li>Channel: {config.serverConfig.channelId || "—"}</li>
              <li>Mirror Type: {config.serverConfig.mirrorType || "—"}</li>
              <li>Mirror Configured: {config.serverConfig.mirrorWebhookConfigured ? "Yes" : "No"}</li>
            </ul>
          </div>
        </div>
      ) : null}

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
