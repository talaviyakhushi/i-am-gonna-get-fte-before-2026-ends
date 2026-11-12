import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { JobPayload } from "@resume-tailor/shared";
import type { CompiledResume, JobSignals, SelectedBullet } from "./tailoring-pipeline.js";

const jobSignals: JobSignals = {
  primary_tech: ["Go"],
  secondary_tech: [],
  core_responsibilities: ["design and test software"],
  domain_keywords: ["Agile"],
};

const selected: SelectedBullet[] = [
  { experienceId: "acme_role", bulletId: "acme_1", text: "Did a thing", tags: ["Go"], score: 3, isSpare: false },
];

function makeCompiled(overrides: Partial<CompiledResume> = {}): CompiledResume {
  return {
    content: "Boosted revenue by 300%\nLed team of 5 engineers\n",
    warnings: [],
    flaggedBulletIds: [],
    ...overrides,
  };
}

const runTailoringPipeline = vi.fn();
vi.mock("./tailoring-pipeline.js", () => ({
  runTailoringPipeline: (...args: unknown[]) => runTailoringPipeline(...args),
}));

const job: JobPayload = {
  title: "Senior Engineer",
  company: "Acme",
  url: "https://example.com/job",
  description: "d".repeat(220),
  confidence: "high",
  confirmed: true,
};

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
  process.env.AUTH_TOKEN = "test-auth-token";
});

beforeEach(() => {
  vi.clearAllMocks();
  runTailoringPipeline.mockResolvedValue({ jobSignals, selected, compiled: makeCompiled() });
});

const today = new Date().toISOString().slice(0, 10);

afterEach(async () => {
  // Tests write into the real tailored-resumes/ folder (resolved from this
  // file's location) — clean up so test runs never leave output behind.
  const { TAILORED_RESUMES_DIR } = await import("./claude-agent.js");
  await fs.rm(path.join(TAILORED_RESUMES_DIR, today, "acme"), { recursive: true, force: true });

  // The successful-run test also appends a real row to the shared
  // applications-tracker.csv — strip just that row rather than touching the
  // rest of the file, which may hold the user's actual application history.
  const trackerPath = path.join(TAILORED_RESUMES_DIR, "applications-tracker.csv");
  const trackerContent = await fs.readFile(trackerPath, "utf8").catch(() => null);
  if (trackerContent) {
    const filtered = trackerContent
      .split("\n")
      .filter((line) => !line.includes(",Acme,Senior Engineer,"))
      .join("\n");
    await fs.writeFile(trackerPath, filtered, "utf8");
  }
});

describe("startAgentRun", () => {
  it("runs the 4-step pipeline in order and saves output locally", async () => {
    const { startAgentRun, isRunActive, TAILORED_RESUMES_DIR } = await import("./claude-agent.js");
    const { createRun, getRun, clearAllRuns } = await import("./run-store.js");
    clearAllRuns();

    const runId = "11112222-3333-4444-5555-666677778888";
    createRun(runId);
    await startAgentRun(runId, job);

    const run = getRun(runId)!;
    expect(run.error).toBeUndefined();
    expect(run.status).toBe("succeeded");

    // Status transitions in order
    const statuses = run.events
      .filter((e) => e.type === "status")
      .map((e) => (e.data as { status?: string }).status)
      .filter(Boolean);
    expect(statuses).toEqual(["preparing", "running", "saving", "succeeded"]);

    // Pipeline was invoked once with the job description and known source paths
    expect(runTailoringPipeline).toHaveBeenCalledTimes(1);
    const call = runTailoringPipeline.mock.calls[0]![0] as { jobDescriptionText: string };
    expect(call.jobDescriptionText).toBe(job.description);

    // Narration events replace the old tool-call transcript
    const assistantTexts = run.events
      .filter((e) => e.type === "assistant")
      .map((e) => (e.data as { text: string }).text);
    expect(assistantTexts.some((t) => t.includes("primary_tech"))).toBe(true);
    expect(assistantTexts.some((t) => t.includes("Selected 1 bullet"))).toBe(true);

    // Result shape: local output dir, not a PR — date-first so a growing
    // number of applications stays browsable by when they were tailored.
    expect(run.result).toMatchObject({
      outputDir: `${today}/acme/senior-engineer`,
      files: [`${today}/acme/senior-engineer/tailored-resume.tex`],
    });
    expect(run.result?.warnings).toBeUndefined();

    // Compiled content actually lands on disk in the local tailored-resumes/ folder
    const savedTex = await fs.readFile(
      path.join(TAILORED_RESUMES_DIR, today, "acme", "senior-engineer", "tailored-resume.tex"),
      "utf8",
    );
    expect(savedTex).toContain("Boosted revenue by 300%");

    // A tracker row gets appended for every successful run — auto-filled
    // fields only, status/date-applied stay blank for the user to fill in.
    const trackerContent = await fs.readFile(
      path.join(TAILORED_RESUMES_DIR, "applications-tracker.csv"),
      "utf8",
    );
    expect(trackerContent).toContain("Date,Company,Role,Status,OutputPath");
    expect(trackerContent).toContain(
      `${today},Acme,Senior Engineer,Tailored,${today}/acme/senior-engineer`,
    );

    // Lock released after run
    expect(isRunActive()).toBe(false);
  });

  it("surfaces audit warnings from step 4 on both the event log and the result", async () => {
    runTailoringPipeline.mockResolvedValue({
      jobSignals,
      selected,
      compiled: makeCompiled({
        warnings: ['New claim(s) not traceable to original bullet or its tags: "Kubernetes" — reverted bullet acme_1 to original text.'],
        flaggedBulletIds: ["acme_1"],
      }),
    });

    const { startAgentRun } = await import("./claude-agent.js");
    const { createRun, getRun, clearAllRuns } = await import("./run-store.js");
    clearAllRuns();

    const runId = "99998888-3333-4444-5555-666677778888";
    createRun(runId);
    await startAgentRun(runId, job);

    const run = getRun(runId)!;
    expect(run.status).toBe("succeeded");
    expect(run.result?.warnings).toHaveLength(1);

    const warningEvent = run.events.find(
      (e) => e.type === "status" && (e.data as { honestyWarnings?: unknown }).honestyWarnings,
    );
    expect(warningEvent).toBeDefined();
  });

  it("marks the run failed when the pipeline throws", async () => {
    runTailoringPipeline.mockRejectedValueOnce(new Error("Anthropic API error: rate limited"));

    const { startAgentRun } = await import("./claude-agent.js");
    const { createRun, getRun, clearAllRuns } = await import("./run-store.js");
    clearAllRuns();

    const runId = "ccccdddd-3333-4444-5555-666677778888";
    createRun(runId);
    await startAgentRun(runId, job);

    const run = getRun(runId)!;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/rate limited/i);
  });

  it("marks the run failed if the local save step throws", async () => {
    const { startAgentRun } = await import("./claude-agent.js");
    const { createRun, getRun, clearAllRuns } = await import("./run-store.js");
    clearAllRuns();

    vi.spyOn(fs, "mkdir").mockRejectedValueOnce(new Error("ENOENT: no such file or directory"));

    const runId = "aaaabbbb-3333-4444-5555-666677778888";
    createRun(runId);
    await startAgentRun(runId, job);

    const run = getRun(runId)!;
    expect(run.status).toBe("failed");
    expect(run.error).toContain("ENOENT");
  });
});

describe("slugify", () => {
  it("lowercases, hyphenates, and strips legal suffixes", async () => {
    const { slugify } = await import("./claude-agent.js");
    expect(slugify("Acme Corp Inc.")).toBe("acme-corp");
    expect(slugify("Senior Software Engineer")).toBe("senior-software-engineer");
    expect(slugify("Wipro Limited")).toBe("wipro-limited");
  });
});
