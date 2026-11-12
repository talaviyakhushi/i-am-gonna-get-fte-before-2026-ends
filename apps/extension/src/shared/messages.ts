import type { JobExtractResult, JobPayload, RunEvent } from "@resume-tailor/shared";

export type ExtensionMessage =
  | { type: "JOB_EXTRACTED"; payload: JobExtractResult }
  | { type: "GET_LAST_EXTRACT" }
  | { type: "EXTRACT_NOW" }
  | {
      type: "API_FETCH";
      path: string;
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      };
    }
  | { type: "START_RUN"; job: JobPayload }
  | { type: "GET_ACTIVE_RUN" }
  | { type: "CLEAR_ACTIVE_RUN" }
  | { type: "ACTIVE_RUN_UPDATE"; run: ActiveRunState };

export interface ApiFetchResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

export interface ActiveRunResult {
  /** Path relative to the local tailored-resumes/ folder, e.g. "acme/senior-engineer". */
  outputDir?: string;
  files?: string[];
  warnings?: string[];
}

/** Run state owned by the background worker so it survives popup close. */
export interface ActiveRunState {
  runId: string;
  status: string;
  events: RunEvent[];
  result: ActiveRunResult | null;
  error: string | null;
  done: boolean;
}
