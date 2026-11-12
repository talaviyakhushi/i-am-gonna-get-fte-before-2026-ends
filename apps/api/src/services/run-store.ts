import type {
  RunCompleteResponse,
  RunEvent,
  ServerRunStatus,
} from "@resume-tailor/shared";

export interface RunRecord {
  runId: string;
  status: ServerRunStatus;
  events: RunEvent[];
  result?: RunCompleteResponse;
  error?: string;
  createdAt: number;
}

const TERMINAL_STATUSES: ReadonlySet<ServerRunStatus> = new Set([
  "succeeded",
  "failed",
  "blocked",
  "stale",
]);

const runs = new Map<string, RunRecord>();

export function createRun(runId: string): RunRecord {
  const record: RunRecord = {
    runId,
    status: "submitting",
    events: [],
    createdAt: Date.now(),
  };
  runs.set(runId, record);
  return record;
}

export function getRun(runId: string): RunRecord | undefined {
  return runs.get(runId);
}

export function appendEvent(runId: string, event: RunEvent): void {
  runs.get(runId)?.events.push(event);
}

export function setStatus(runId: string, status: ServerRunStatus): void {
  const record = runs.get(runId);
  if (!record) return;
  record.status = status;
  record.events.push({ ts: Date.now(), type: "status", data: { status } });
}

export function setResult(runId: string, result: RunCompleteResponse): void {
  const record = runs.get(runId);
  if (!record) return;
  record.result = result;
  record.events.push({ ts: Date.now(), type: "complete", data: result });
}

export function setError(runId: string, error: string): void {
  const record = runs.get(runId);
  if (!record) return;
  record.error = error;
  record.events.push({ ts: Date.now(), type: "error", data: { error } });
}

export function isTerminal(status: ServerRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Test helper — wipes all runs. */
export function clearAllRuns(): void {
  runs.clear();
}
