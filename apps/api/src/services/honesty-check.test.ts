import { describe, it, expect } from "vitest";
import { honestyCheck } from "./honesty-check.js";
import type { JobPayload } from "@resume-tailor/shared";

const job: JobPayload = {
  title: "Senior Engineer",
  company: "Acme",
  url: "https://example.com/job",
  description: "We need someone who improved throughput by 40% and knows Go.",
  confidence: "high",
  confirmed: true,
};

const originalResume = `# Jane Doe
- Led team of 5 engineers
- Reduced latency by 25%
- Managed $1.2M budget in 2022`;

function diffAdding(lines: string[]): string {
  return lines.map((l) => `+${l}`).join("\n");
}

describe("honestyCheck", () => {
  it("passes when added claims exist in the original resume", () => {
    const diff = diffAdding(["Reduced latency by 25% across services"]);
    expect(honestyCheck(originalResume, diff, job)).toEqual([]);
  });

  it("passes when added claims come from the job description", () => {
    const diff = diffAdding(["Improved throughput by 40%"]);
    expect(honestyCheck(originalResume, diff, job)).toEqual([]);
  });

  it("flags a fabricated percentage", () => {
    const diff = diffAdding(["Boosted revenue by 300%"]);
    const warnings = honestyCheck(originalResume, diff, job);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("300%");
  });

  it("flags fabricated dollar amounts and multipliers", () => {
    const diff = diffAdding(["Saved $5M annually", "Achieved 10x speedup"]);
    const warnings = honestyCheck(originalResume, diff, job);
    expect(warnings.some((w) => w.includes("$5M"))).toBe(true);
    expect(warnings.some((w) => w.includes("10x"))).toBe(true);
  });

  it("ignores removed lines and diff headers", () => {
    const diff = ["--- a/resume.md", "+++ b/resume.md", "-Old line with 999%"].join("\n");
    expect(honestyCheck(originalResume, diff, job)).toEqual([]);
  });

  it("does not duplicate warnings for repeated claims", () => {
    const diff = diffAdding(["Grew sales 300%", "Again grew 300%"]);
    const warnings = honestyCheck(originalResume, diff, job);
    expect(warnings.filter((w) => w.includes("300%"))).toHaveLength(1);
  });
});
