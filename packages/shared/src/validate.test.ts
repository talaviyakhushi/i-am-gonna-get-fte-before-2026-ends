import { describe, it, expect } from "vitest";
import { validateJobPayload, JobPayloadValidationError } from "./validate.js";
import { slugify } from "./slugify.js";

const validJob = {
  title: "Senior Software Engineer",
  company: "Acme Corp",
  url: "https://boards.greenhouse.io/acme/jobs/123",
  description: "x".repeat(250),
  confidence: "high" as const,
  confirmed: true as const,
};

describe("validateJobPayload", () => {
  it("accepts a valid confirmed payload", () => {
    expect(() => validateJobPayload(validJob)).not.toThrow();
  });

  it("rejects non-object payloads", () => {
    expect(() => validateJobPayload(null)).toThrow(JobPayloadValidationError);
    expect(() => validateJobPayload("job")).toThrow(JobPayloadValidationError);
    expect(() => validateJobPayload(undefined)).toThrow(JobPayloadValidationError);
  });

  it("rejects unconfirmed payloads", () => {
    expect(() => validateJobPayload({ ...validJob, confirmed: false })).toThrow(/confirmed/);
    const { confirmed, ...rest } = validJob;
    expect(() => validateJobPayload(rest)).toThrow(/confirmed/);
  });

  it("rejects missing or blank title", () => {
    expect(() => validateJobPayload({ ...validJob, title: "" })).toThrow(/title/);
    expect(() => validateJobPayload({ ...validJob, title: "   " })).toThrow(/title/);
    expect(() => validateJobPayload({ ...validJob, title: undefined })).toThrow(/title/);
  });

  it("rejects missing company", () => {
    expect(() => validateJobPayload({ ...validJob, company: "" })).toThrow(/company/);
  });

  it("rejects missing url", () => {
    expect(() => validateJobPayload({ ...validJob, url: "" })).toThrow(/url/);
  });

  it("rejects descriptions shorter than 200 chars", () => {
    expect(() => validateJobPayload({ ...validJob, description: "short" })).toThrow(/200/);
    expect(() => validateJobPayload({ ...validJob, description: "x".repeat(199) })).toThrow(/200/);
  });

  it("accepts a description of exactly 200 chars", () => {
    expect(() => validateJobPayload({ ...validJob, description: "x".repeat(200) })).not.toThrow();
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Senior Software Engineer")).toBe("senior-software-engineer");
  });

  it("collapses runs of non-alphanumerics", () => {
    expect(slugify("C++ / Rust Developer!!")).toBe("c-rust-developer");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Acme Corp--  ")).toBe("acme-corp");
  });

  it("strips accents", () => {
    expect(slugify("Café Zoë")).toBe("cafe-zoe");
  });

  it("handles empty result", () => {
    expect(slugify("!!!")).toBe("");
  });
});
