import type { JobPayload } from "./types.js";

const MIN_DESCRIPTION_LENGTH = 200;

export class JobPayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobPayloadValidationError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates a job payload before starting an agent run.
 * Throws JobPayloadValidationError describing the first problem found.
 */
export function validateJobPayload(payload: unknown): asserts payload is JobPayload {
  if (payload === null || typeof payload !== "object") {
    throw new JobPayloadValidationError("Job payload must be an object");
  }
  const job = payload as Partial<JobPayload>;

  if (job.confirmed !== true) {
    throw new JobPayloadValidationError(
      "Job payload must be confirmed by the user before submission",
    );
  }
  if (!isNonEmptyString(job.title)) {
    throw new JobPayloadValidationError("Job payload is missing a title");
  }
  if (!isNonEmptyString(job.company)) {
    throw new JobPayloadValidationError("Job payload is missing a company");
  }
  if (!isNonEmptyString(job.url)) {
    throw new JobPayloadValidationError("Job payload is missing a url");
  }
  if (typeof job.description !== "string" || job.description.length < MIN_DESCRIPTION_LENGTH) {
    throw new JobPayloadValidationError(
      `Job description must be at least ${MIN_DESCRIPTION_LENGTH} characters`,
    );
  }
}
