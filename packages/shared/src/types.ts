export interface JobExtractResult {
  title: string;
  company: string;
  url: string;
  description: string;
  confidence: "high" | "low";
}

export interface JobPayload extends JobExtractResult {
  confirmed: true;
  /** Skip the stale-posting gate — set when the user confirms they want to
   *  proceed anyway (e.g. a "closed" listing that's actually been reposted). */
  force?: boolean;
}

export interface CreateRunRequest {
  job: JobPayload;
}

export interface CreateRunResponse {
  runId: string;
}

export type ServerRunStatus =
  | "submitting"
  | "preparing"
  | "running"
  | "saving"
  | "succeeded"
  | "failed"
  | "blocked"
  | "stale";

export type RunEventType =
  | "status"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "complete"
  | "error";

export interface RunEvent {
  ts: number;
  type: RunEventType;
  data: unknown;
}

export interface RunCompleteResponse {
  /** Path relative to the local tailored-resumes/ folder, e.g. "acme/senior-engineer". */
  outputDir: string;
  /** Relative paths of files written, e.g. ["acme/senior-engineer/fit-report.md"]. */
  files: string[];
  warnings?: string[];
}
