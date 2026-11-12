import { useCallback, useEffect, useRef, useState } from "react";
import type { JobExtractResult, RunEvent } from "@resume-tailor/shared";
import type { ActiveRunState, ExtensionMessage } from "../shared/messages.js";

type Phase = "loading" | "no_job" | "confirm" | "running" | "done" | "error";

const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: 14 },
  h1: { fontSize: 15, margin: "0 0 10px" },
  label: { display: "block", fontWeight: 600, margin: "8px 0 2px" },
  input: { width: "100%", boxSizing: "border-box", padding: 5, fontSize: 13 },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    padding: 5,
    fontSize: 12,
    fontFamily: "inherit",
    height: 110,
    resize: "vertical",
  },
  button: {
    marginTop: 12,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    background: "#1a56db",
    color: "#fff",
    border: "none",
    borderRadius: 5,
  },
  secondary: {
    marginTop: 8,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
    background: "#e5e7eb",
    border: "none",
    borderRadius: 5,
  },
  log: {
    marginTop: 10,
    maxHeight: 220,
    overflowY: "auto",
    background: "#f6f8fa",
    border: "1px solid #d0d7de",
    borderRadius: 5,
    padding: 8,
    fontSize: 11.5,
    fontFamily: "ui-monospace, monospace",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    background: "#fde68a",
  },
  runningBadge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    background: "#bfdbfe",
    color: "#1e3a8a",
  },
  error: { color: "#b91c1c", marginTop: 8, fontSize: 12 },
  warn: {
    background: "#fef3c7",
    border: "1px solid #f59e0b",
    borderRadius: 5,
    padding: 8,
    marginTop: 8,
    fontSize: 12,
  },
};

function describeEvent(event: RunEvent): string {
  const data = event.data as Record<string, unknown>;
  switch (event.type) {
    case "status":
      if (data.status) return `▸ status: ${String(data.status)}`;
      if (data.honestyWarnings) return `⚠ honesty check flagged ${(data.honestyWarnings as string[]).length} claim(s)`;
      if (data.staleOverride) return `⚠ proceeding despite stale posting (${String(data.ageDays)} days old, posted ${String(data.datePosted)})`;
      return `▸ ${JSON.stringify(data)}`;
    case "assistant": {
      const text = String(data.text ?? "");
      return `🤖 ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`;
    }
    case "tool_call":
      return `🔧 ${String(data.name)}(${JSON.stringify(data.input ?? {}).slice(0, 120)})`;
    case "tool_result":
      return data.is_error ? `✗ tool error` : `✓ tool result`;
    case "complete":
      return `✔ agent loop complete`;
    case "error":
      return `✗ ${String(data.error ?? "unknown error")}`;
    default:
      return JSON.stringify(event);
  }
}

export function Popup() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [job, setJob] = useState<JobExtractResult | null>(null);
  const [run, setRun] = useState<ActiveRunState | null>(null);
  const [error, setError] = useState<string>("");
  const logRef = useRef<HTMLDivElement>(null);

  const applyRunState = useCallback((activeRun: ActiveRunState | null) => {
    if (!activeRun) return false;
    setRun(activeRun);
    setPhase(activeRun.done ? "done" : "running");
    if (activeRun.error) setError(activeRun.error);
    return true;
  }, []);

  const loadExtract = useCallback(async () => {
    const extract = (await chrome.runtime.sendMessage({
      type: "GET_LAST_EXTRACT",
    })) as JobExtractResult | null;
    if (extract) {
      setJob(extract);
      setPhase("confirm");
    } else {
      setPhase("no_job");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // A run in progress (or just finished) always wins over showing the
      // confirm/rescan screen — the popup should resume, not restart.
      const activeRun = (await chrome.runtime.sendMessage({
        type: "GET_ACTIVE_RUN",
      })) as ActiveRunState | null;
      if (applyRunState(activeRun)) return;
      await loadExtract();
    })();
  }, [applyRunState, loadExtract]);

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message?.type === "ACTIVE_RUN_UPDATE") {
        applyRunState(message.run);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [applyRunState]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [run?.events]);

  const scanAnotherJob = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_ACTIVE_RUN" });
    setRun(null);
    setError("");
    await loadExtract();
  }, [loadExtract]);

  const rescan = useCallback(async () => {
    setError("");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab");
      // Inject content script on demand (works on any page via activeTab).
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      const extract = (await chrome.tabs
        .sendMessage(tab.id, { type: "EXTRACT_NOW" })
        .catch(() => null)) as JobExtractResult | null;
      if (extract) {
        setJob(extract);
        setPhase("confirm");
      } else {
        await loadExtract();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadExtract]);

  const submit = useCallback(async (force = false) => {
    if (!job) return;
    setError("");
    setRun(null);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "START_RUN",
        job: { ...job, confirmed: true, ...(force ? { force: true } : {}) },
      })) as { ok: boolean; runId?: string; error?: string };
      if (!response.ok) {
        throw new Error(response.error ?? "Failed to start run");
      }
      setPhase("running");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("confirm");
    }
  }, [job]);

  const updateField = (field: keyof JobExtractResult, value: string) => {
    setJob((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>Resume Tailor Agent</h1>

      {phase === "loading" && <p>Loading…</p>}

      {phase === "no_job" && (
        <>
          <p>
            No job posting captured yet. Open a job page (LinkedIn, Greenhouse,
            Lever…) or scan the current page.
          </p>
          <button style={styles.button} onClick={() => void rescan()}>
            Scan this page
          </button>
        </>
      )}

      {phase === "confirm" && job && (
        <>
          {job.confidence === "low" && (
            <p>
              <span style={styles.badge}>low confidence</span>{" "}
              Extraction looks incomplete — please review and edit.
            </p>
          )}
          <label style={styles.label}>Job title</label>
          <input
            style={styles.input}
            value={job.title}
            onChange={(e) => updateField("title", e.target.value)}
          />
          <label style={styles.label}>Company</label>
          <input
            style={styles.input}
            value={job.company}
            onChange={(e) => updateField("company", e.target.value)}
          />
          <label style={styles.label}>URL</label>
          <input
            style={styles.input}
            value={job.url}
            onChange={(e) => updateField("url", e.target.value)}
          />
          <label style={styles.label}>
            Description ({job.description.length} chars)
          </label>
          <textarea
            style={styles.textarea}
            value={job.description}
            onChange={(e) => updateField("description", e.target.value)}
          />
          <div>
            <button style={styles.button} onClick={() => void submit()}>
              Looks right — tailor my resume
            </button>
            <button style={styles.secondary} onClick={() => void rescan()}>
              Re-scan page
            </button>
          </div>
        </>
      )}

      {(phase === "running" || phase === "done") && run && (
        <>
          <p>
            {phase === "running" ? (
              <span style={styles.runningBadge}>running in background</span>
            ) : (
              <span style={styles.badge}>done</span>
            )}{" "}
            Status: <strong>{run.status || "starting"}</strong>
          </p>
          {phase === "running" && (
            <p style={{ fontSize: 11, color: "#57606a" }}>
              Safe to close this popup — the run keeps going and you'll get a
              notification when it's done.
            </p>
          )}
          <div style={styles.log} ref={logRef}>
            {run.events.map((event, i) => (
              <div key={i}>{describeEvent(event)}</div>
            ))}
          </div>
          {run.status === "stale" && job && (
            <div style={styles.warn}>
              <strong>Posting looks stale</strong>
              <p style={{ margin: "4px 0 0" }}>
                {run.error ?? "This posting is older than the freshness threshold."}{" "}
                Sometimes a role reopens or was never actually filled — scan it
                anyway if you think that's the case here.
              </p>
              <button style={styles.secondary} onClick={() => void submit(true)}>
                Scan anyway
              </button>
            </div>
          )}
          {run.result?.warnings && run.result.warnings.length > 0 && (
            <div style={styles.warn}>
              <strong>Honesty-check warnings</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {run.result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {run.result?.outputDir && (
            <p>
              ✅ Saved to{" "}
              <code>tailored-resumes/{run.result.outputDir}</code>
            </p>
          )}
          {phase === "done" && (
            <button style={styles.button} onClick={() => void scanAnotherJob()}>
              Scan another job
            </button>
          )}
        </>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}
