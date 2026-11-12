import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slugify, type JobPayload } from "@resume-tailor/shared";
import { getConfig } from "../config.js";
import {
  appendEvent,
  setError,
  setResult,
  setStatus,
} from "./run-store.js";
import { detectSponsorshipBlock } from "./sponsorship-check.js";
import { getPostingAge, STALE_POSTING_THRESHOLD_DAYS } from "./posting-age-check.js";
import { runTailoringPipeline } from "./tailoring-pipeline.js";

/** Only one run at a time — there's a single local profile/resume source. */
let activeRunId: string | undefined;
const abortControllers = new Map<string, AbortController>();

/** Project root (this repo's top level), resolved from this file's location. */
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
/** Source of truth: profile.yaml and the LaTeX template. */
export const RESUME_SOURCE_DIR = path.join(PROJECT_ROOT, "example-resume-repo");
export const PROFILE_YAML_PATH = path.join(RESUME_SOURCE_DIR, "profile.yaml");
export const TEMPLATE_PATH = path.join(RESUME_SOURCE_DIR, "templates", "resume-template.tex");
/**
 * Local output folder — tailored resumes are saved here, no git/PR involved.
 * Overridable so a deployed instance can point this at a mounted volume
 * (container filesystem is otherwise wiped on every redeploy/restart).
 */
export const TAILORED_RESUMES_DIR = process.env.TAILORED_RESUMES_DIR
  ? path.resolve(process.env.TAILORED_RESUMES_DIR)
  : path.join(PROJECT_ROOT, "tailored-resumes");

export function isRunActive(): boolean {
  return activeRunId !== undefined;
}

export function cancelAll(): void {
  for (const controller of abortControllers.values()) {
    controller.abort();
  }
  abortControllers.clear();
  activeRunId = undefined;
}

/** Strip keys and absolute tmp paths from error messages before storing. */
export function sanitizeError(message: string): string {
  const config = safeConfig();
  let sanitized = message;
  if (config?.anthropicApiKey) {
    sanitized = sanitized.split(config.anthropicApiKey).join("[redacted]");
  }
  if (config?.authToken) {
    sanitized = sanitized.split(config.authToken).join("[redacted]");
  }
  return sanitized
    .replace(/sk-ant-[A-Za-z0-9-_]+/g, "[redacted-key]")
    .replace(new RegExp(escapeRegExp(os.tmpdir()) + "[^\\s'\"]*", "g"), "[tmp]");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeConfig(): ReturnType<typeof getConfig> | undefined {
  try {
    return getConfig();
  } catch {
    return undefined;
  }
}

/** Emits a synthetic "assistant"-style narration event — keeps the event log meaningful now that there's no tool-loop transcript to relay. */
function narrate(runId: string, text: string): void {
  appendEvent(runId, { ts: Date.now(), type: "assistant", data: { text } });
}

const TRACKER_PATH = path.join(TAILORED_RESUMES_DIR, "applications-tracker.csv");
const TRACKER_HEADER = "Date,Company,Role,Status,OutputPath\n";

/** Escapes a CSV field per RFC 4180: wrap in quotes if it has a comma, quote, or newline. */
function csvEscape(field: string): string {
  if (/[",\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Appends one row per successful run to a flat tracker file — auto-filled
 * fields only (date, company, role, output path). Status/date-applied/notes
 * are left for the user to fill in by hand afterward; the tool only knows
 * a resume was generated, not whether it was actually submitted.
 */
async function appendToTracker(date: string, company: string, role: string, outputDir: string): Promise<void> {
  const exists = await fs
    .access(TRACKER_PATH)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    await fs.mkdir(TAILORED_RESUMES_DIR, { recursive: true });
    await fs.writeFile(TRACKER_PATH, TRACKER_HEADER, "utf8");
  }
  const row = [date, company, role, "Tailored", outputDir].map(csvEscape).join(",");
  await fs.appendFile(TRACKER_PATH, `${row}\n`, "utf8");
}

export async function startAgentRun(runId: string, job: JobPayload): Promise<void> {
  const abortController = new AbortController();

  activeRunId = runId;
  abortControllers.set(runId, abortController);

  try {
    // 0. Bail before spending any pipeline calls if the posting rules out
    // visa sponsorship — tailoring a resume for a role that will reject on
    // that basis alone is wasted work.
    const sponsorshipBlock = detectSponsorshipBlock(job.description);
    if (sponsorshipBlock) {
      setError(
        runId,
        `Job posting states no visa sponsorship ("${sponsorshipBlock}") — skipped tailoring.`,
      );
      setStatus(runId, "blocked");
      return;
    }

    // 0b. Bail if the posting's own JSON-LD structured data says it's
    // stale — reposts reset a platform's displayed date, so this reads the
    // schema.org JobPosting.datePosted the original page embeds, same
    // source sites like howoldisthisjob.com use. Unknown (no structured
    // data, fetch failure, unparseable date) is not evidence of staleness —
    // proceed as normal in that case.
    const postingAge = await getPostingAge(job.url);
    if (postingAge && postingAge.ageDays > STALE_POSTING_THRESHOLD_DAYS) {
      if (!job.force) {
        setError(
          runId,
          `Posting is ${postingAge.ageDays} days old (posted ${postingAge.datePosted}) — likely stale, skipped tailoring. Reposted listings happen — retry with the override if the role looks genuinely open.`,
        );
        setStatus(runId, "stale");
        return;
      }
      // User confirmed they want to proceed despite the stale flag — keep
      // the fact visible in the event log and fit report instead of
      // silently dropping it.
      appendEvent(runId, {
        ts: Date.now(),
        type: "status",
        data: {
          staleOverride: true,
          ageDays: postingAge.ageDays,
          datePosted: postingAge.datePosted,
        },
      });
    }

    // 1. Run the 4-step pipeline: extract JD signals, select relevant
    // profile.yaml bullets, rephrase the selected ones, then audit + inject
    // into the LaTeX template. No scratch-dir copy or tool loop needed —
    // the pipeline reads profile.yaml/the template directly and returns
    // compiled content in memory.
    setStatus(runId, "preparing");
    narrate(runId, "Extracting job signals from the posting.");

    setStatus(runId, "running");
    const { jobSignals, selected, compiled } = await runTailoringPipeline({
      jobDescriptionText: job.description,
      profileYamlPath: PROFILE_YAML_PATH,
      templatePath: TEMPLATE_PATH,
      signal: abortController.signal,
    });

    narrate(
      runId,
      `Signals: primary_tech=[${jobSignals.primary_tech.join(", ")}], secondary_tech=[${jobSignals.secondary_tech.join(", ")}].`,
    );
    narrate(
      runId,
      `Selected ${selected.length} bullet(s) across ${new Set(selected.map((b) => b.experienceId)).size} experience(s).`,
    );

    if (abortController.signal.aborted) {
      throw new Error("Run cancelled during shutdown");
    }

    // 2. Save the compiled resume locally. No git commit, push, or PR —
    // this is a plain local save. Slug convention matches the old
    // SKILL.md-driven output layout so existing tooling (tracker,
    // date-first folder browsing) keeps working unchanged.
    setStatus(runId, "saving");
    const dateFolder = new Date().toISOString().slice(0, 10);
    const companySlug = slugify(job.company);
    const roleSlug = slugify(job.title);
    const relFromTailored = `${dateFolder}/${companySlug}/${roleSlug}`;
    const destDir = path.join(TAILORED_RESUMES_DIR, relFromTailored);
    await fs.mkdir(destDir, { recursive: true });

    const texFileName = "tailored-resume.tex";
    await fs.writeFile(path.join(destDir, texFileName), compiled.content, "utf8");
    const filesWritten = [`${relFromTailored}/${texFileName}`];

    if (compiled.warnings.length > 0) {
      appendEvent(runId, {
        ts: Date.now(),
        type: "status",
        data: { honestyWarnings: compiled.warnings },
      });
    }

    await appendToTracker(dateFolder, job.company, job.title, relFromTailored);

    // 3. Done — status first, then result: the client renders "done" off
    // the status event, so setting status after the result event leaves a
    // window where the "✅ Saved to..." line is visible while the badge
    // still reads an earlier in-progress status.
    setStatus(runId, "succeeded");
    setResult(runId, {
      outputDir: relFromTailored,
      files: filesWritten,
      ...(compiled.warnings.length > 0 ? { warnings: compiled.warnings } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(runId, sanitizeError(message));
    setStatus(runId, "failed");
  } finally {
    activeRunId = undefined;
    abortControllers.delete(runId);
  }
}
