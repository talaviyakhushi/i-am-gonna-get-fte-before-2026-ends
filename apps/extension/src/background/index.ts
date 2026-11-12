import type { CreateRunResponse, JobExtractResult, RunEvent } from "@resume-tailor/shared";
import type { ActiveRunResult, ActiveRunState, ApiFetchResult, ExtensionMessage } from "../shared/messages.js";
import { applyDefaultSettings } from "../shared/apply-default-settings.js";
import { getSettings } from "../shared/settings.js";

let lastExtract: JobExtractResult | null = null;
let activeRun: ActiveRunState | null = null;

const ACTIVE_RUN_STORAGE_KEY = "activeRun";

chrome.runtime.onInstalled.addListener(() => {
  void applyDefaultSettings();
});

// Restore in-flight run state if the service worker was recycled mid-run.
// A restored "not done" run might not actually exist anymore server-side
// (e.g. the API restarted, wiping its in-memory run store) — verify before
// trusting it, otherwise the popup shows "running" forever with nothing on
// the other end to ever resolve it.
void chrome.storage.local.get(ACTIVE_RUN_STORAGE_KEY).then(async (stored) => {
  const restored = stored[ACTIVE_RUN_STORAGE_KEY] as ActiveRunState | undefined;
  if (!restored || restored.done) return;

  const settings = await getSettings();
  if (!settings.apiUrl) return;

  try {
    const res = await fetch(`${settings.apiUrl}/runs/${restored.runId}`, {
      headers: { "X-Resume-Agent-Token": settings.token },
    });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    // Still known server-side — resume tracking it.
    activeRun = restored;
    void streamRunInBackground(restored.runId);
  } catch {
    // Server has no memory of this run (restarted, or genuinely gone) —
    // clear the stale state instead of leaving the popup stuck forever.
    activeRun = { ...restored, done: true, error: "Run no longer exists on the server (it likely restarted) — state cleared." };
    persistActiveRun();
  }
});

function persistActiveRun(): void {
  void chrome.storage.local.set({ [ACTIVE_RUN_STORAGE_KEY]: activeRun });
}

function broadcastActiveRun(): void {
  if (!activeRun) return;
  void chrome.runtime.sendMessage({ type: "ACTIVE_RUN_UPDATE", run: activeRun }).catch(() => {
    // No popup listening right now — that's fine, state is persisted.
  });
}

// 1x1 transparent PNG — avoids requiring a bundled icon asset just for
// notifications; Chrome renders the extension's own icon alongside it.
const NOTIFICATION_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function notify(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title,
      message,
      priority: 2,
    });
  } catch {
    // Notifications are best-effort; never block run completion on this.
  }
}

async function handleApiFetch(
  message: Extract<ExtensionMessage, { type: "API_FETCH" }>,
): Promise<ApiFetchResult> {
  try {
    const settings = await getSettings();
    if (!settings.apiUrl) {
      return { ok: false, error: "API URL not configured. Open extension options." };
    }
    const response = await fetch(`${settings.apiUrl}${message.path}`, {
      method: message.init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Resume-Agent-Token": settings.token,
        ...message.init?.headers,
      },
      body: message.init?.body,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON — return raw text.
    }
    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Streams run events from GET /runs/:id/events, entirely inside the
 * background worker so the connection survives the popup closing.
 *
 * EventSource cannot send the auth header, so we consume the SSE stream with
 * fetch + ReadableStream directly.
 */
async function streamRunInBackground(runId: string): Promise<void> {
  try {
    const settings = await getSettings();
    const response = await fetch(`${settings.apiUrl}/runs/${runId}/events`, {
      headers: { "X-Resume-Agent-Token": settings.token },
    });
    if (!response.ok || !response.body) {
      finishRun(`Event stream failed with status ${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              handleRunEvent(JSON.parse(line.slice(6)) as RunEvent);
            } catch {
              // Skip malformed frames.
            }
          }
        }
      }
    }
    finishRun();
  } catch (err) {
    finishRun(err instanceof Error ? err.message : String(err));
  }
}

function handleRunEvent(event: RunEvent): void {
  if (!activeRun) return;
  activeRun.events.push(event);
  const data = event.data as Record<string, unknown>;
  if (event.type === "status" && typeof data.status === "string") {
    activeRun.status = data.status;
  }
  if (event.type === "complete" && data.outputDir) {
    activeRun.result = data as ActiveRunResult;
  }
  if (event.type === "error") {
    activeRun.error = String(data.error ?? "Run failed");
  }
  persistActiveRun();
  broadcastActiveRun();
}

function finishRun(streamError?: string): void {
  if (!activeRun) return;
  activeRun.done = true;
  if (streamError) activeRun.error = streamError;
  persistActiveRun();
  broadcastActiveRun();

  if (activeRun.result?.outputDir) {
    void notify(
      "Resume tailoring complete",
      `Saved to tailored-resumes/${activeRun.result.outputDir}`,
    );
  } else if (activeRun.status === "blocked") {
    void notify(
      "Skipped — no visa sponsorship",
      activeRun.error ?? "Job posting excludes visa sponsorship.",
    );
  } else if (activeRun.status === "stale") {
    void notify(
      "Skipped — posting looks stale",
      activeRun.error ?? "Job posting is older than the freshness threshold.",
    );
  } else if (activeRun.error) {
    void notify("Resume tailoring failed", activeRun.error);
  } else {
    void notify("Resume tailoring finished", "Run completed.");
  }
}

async function handleStartRun(
  message: Extract<ExtensionMessage, { type: "START_RUN" }>,
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings.apiUrl) {
      return { ok: false, error: "API URL not configured. Open extension options." };
    }
    const response = await fetch(`${settings.apiUrl}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Resume-Agent-Token": settings.token,
      },
      body: JSON.stringify({ job: message.job }),
    });
    const body = (await response.json().catch(() => null)) as CreateRunResponse & { error?: string };
    if (!response.ok || !body?.runId) {
      return { ok: false, error: body?.error ?? `Request failed with status ${response.status}` };
    }

    activeRun = {
      runId: body.runId,
      status: "submitting",
      events: [],
      result: null,
      error: null,
      done: false,
    };
    persistActiveRun();
    broadcastActiveRun();
    void streamRunInBackground(body.runId);

    return { ok: true, runId: body.runId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message?.type) {
      case "JOB_EXTRACTED":
        lastExtract = message.payload;
        return false;

      case "GET_LAST_EXTRACT":
        sendResponse(lastExtract);
        return false;

      case "API_FETCH":
        void handleApiFetch(message).then(sendResponse);
        return true; // async sendResponse

      case "START_RUN":
        void handleStartRun(message).then(sendResponse);
        return true; // async sendResponse

      case "GET_ACTIVE_RUN":
        sendResponse(activeRun);
        return false;

      case "CLEAR_ACTIVE_RUN":
        // The popup has no other way back to "confirm a new job" once a run
        // finishes — activeRun otherwise stays cached here forever, and
        // every future popup open shows the old completed run again.
        activeRun = null;
        void chrome.storage.local.remove(ACTIVE_RUN_STORAGE_KEY);
        sendResponse({ ok: true });
        return false;

      default:
        return false;
    }
  },
);

chrome.notifications.onClicked.addListener((notificationId) => {
  void chrome.notifications.clear(notificationId);
});
