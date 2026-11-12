import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  JobSignals,
  Profile,
  ProfileBullet,
  RewrittenBullet,
  SelectedBullet,
} from "./tailoring-pipeline.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const REAL_TEMPLATE_PATH = path.join(PROJECT_ROOT, "example-resume-repo", "templates", "resume-template.tex");

// Mock the Anthropic SDK so extractJobSignals/rephraseSelectedBullets never
// hit the network — captures the request so tests can assert exactly what
// was sent (model, forced tool_choice, schema) and controls the response.
const messagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: messagesCreate };
  },
}));

function toolResponse(toolName: string, input: unknown) {
  return {
    content: [{ type: "tool_use", id: "tu_1", name: toolName, input }],
  };
}

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
  process.env.AUTH_TOKEN = "test-auth-token";
});

beforeEach(() => {
  messagesCreate.mockReset();
});

const jobSignals: JobSignals = {
  primary_tech: ["Go", "Kubernetes"],
  secondary_tech: ["Python"],
  core_responsibilities: ["root-cause production issues"],
  domain_keywords: ["Agile"],
};

function bullet(overrides: Partial<ProfileBullet> = {}): ProfileBullet {
  return {
    id: "b1",
    text: "Fixed a race condition affecting 1,000 users",
    tags: ["Go"],
    core_action: "Fixed race condition",
    ...overrides,
  };
}

describe("extractJobSignals", () => {
  it("sends a forced tool_choice call and returns the parsed JobSignals", async () => {
    messagesCreate.mockResolvedValue(toolResponse("record_job_signals", jobSignals));

    const { extractJobSignals } = await import("./tailoring-pipeline.js");
    const result = await extractJobSignals("We need a Go engineer who knows Kubernetes.");

    expect(result).toEqual(jobSignals);
    expect(messagesCreate).toHaveBeenCalledTimes(1);
    const [body] = messagesCreate.mock.calls[0]!;
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_job_signals" });
    expect(body.tools[0].name).toBe("record_job_signals");
    expect(body.messages[0].content).toContain("We need a Go engineer");
  });

  it("throws if the model responds without the expected tool call", async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: "text", text: "not a tool call" }] });

    const { extractJobSignals } = await import("./tailoring-pipeline.js");
    await expect(extractJobSignals("some JD")).rejects.toThrow(/record_job_signals/);
  });
});

describe("scoreBullet", () => {
  it("weights primary_tech matches higher than secondary and domain matches", async () => {
    const { scoreBullet } = await import("./tailoring-pipeline.js");
    const primaryHit = bullet({ tags: ["Go"] });
    const secondaryHit = bullet({ tags: ["Python"] });
    const domainOnlyHit = bullet({ text: "Ran an Agile retro", tags: [] });
    const noHit = bullet({ text: "Fixed CSS", tags: [] });

    expect(scoreBullet(primaryHit, jobSignals)).toBe(3);
    expect(scoreBullet(secondaryHit, jobSignals)).toBe(2);
    expect(scoreBullet(domainOnlyHit, jobSignals)).toBe(1);
    expect(scoreBullet(noHit, jobSignals)).toBe(0);
  });

  it("sums multiple independent matches in the same bullet", async () => {
    const { scoreBullet } = await import("./tailoring-pipeline.js");
    const multi = bullet({ text: "Used Go and Python in an Agile team", tags: ["Go", "Python"] });
    // Go (3) + Python (2) + Agile (1) = 6
    expect(scoreBullet(multi, jobSignals)).toBe(6);
  });
});

describe("selectRelevantBullets", () => {
  function profile(bullets: ProfileBullet[]): Profile {
    return {
      personal_info: {},
      education: [],
      technical_skills: {},
      experiences: [
        { id: "role_a", type: "work", company: "A", role: "Eng", location: null, dates: "", bullets },
      ],
    };
  }

  it("ranks by score and caps at maxPerRole when there are enough positive-score bullets", async () => {
    const { selectRelevantBullets } = await import("./tailoring-pipeline.js");
    const bullets = [
      bullet({ id: "low", text: "Ran an Agile retro", tags: [] }),
      bullet({ id: "high", text: "Built Go and Kubernetes services", tags: ["Go", "Kubernetes"] }),
      bullet({ id: "zero", text: "Fixed CSS", tags: [] }),
    ];

    // spareCount: 0 isolates maxPerRole capping from the default spare
    // over-selection, which is tested separately below.
    const result = await selectRelevantBullets(jobSignals, profile(bullets), { maxPerRole: 1, spareCount: 0 });
    expect(result).toHaveLength(1);
    expect(result[0]!.bulletId).toBe("high");
    expect(result[0]!.isSpare).toBe(false);
  });

  it("backfills with zero-score bullets to guarantee minPerRole when nothing scores positively", async () => {
    const { selectRelevantBullets } = await import("./tailoring-pipeline.js");
    const bullets = [
      bullet({ id: "zero-1", text: "Fixed CSS", tags: [] }),
      bullet({ id: "zero-2", text: "Attended standup", tags: [] }),
      bullet({ id: "zero-3", text: "Updated docs", tags: [] }),
    ];

    // A role with zero JD overlap still needs a fixed number of bullets —
    // the template shows its heading unconditionally, so an empty result
    // here is what caused the reported empty \resumeItem{} bug.
    const result = await selectRelevantBullets(jobSignals, profile(bullets), { minPerRole: 2, spareCount: 0 });
    expect(result).toHaveLength(2);
  });

  it("returns nothing when minPerRole is 0 and no bullet scores positively", async () => {
    const { selectRelevantBullets } = await import("./tailoring-pipeline.js");
    const bullets = [bullet({ id: "zero", text: "Fixed CSS", tags: [] })];

    const result = await selectRelevantBullets(jobSignals, profile(bullets), { minPerRole: 0, spareCount: 0 });
    expect(result).toEqual([]);
  });

  it("never modifies bullet text", async () => {
    const { selectRelevantBullets } = await import("./tailoring-pipeline.js");
    const bullets = [bullet({ id: "high", text: "Built Go services", tags: ["Go"] })];

    const result = await selectRelevantBullets(jobSignals, profile(bullets));
    expect(result[0]!.text).toBe("Built Go services");
  });

  it("selects spareCount extra bullets beyond maxPerRole, marked isSpare, ranked immediately after the primaries", async () => {
    const { selectRelevantBullets } = await import("./tailoring-pipeline.js");
    const bullets = [
      bullet({ id: "p1", text: "Built Go service one", tags: ["Go"] }), // score 3
      bullet({ id: "p2", text: "Built Go service two", tags: ["Go"] }), // score 3
      bullet({ id: "s1", text: "Ran an Agile retro", tags: [] }), // score 1 (domain keyword)
      bullet({ id: "s2", text: "Updated docs", tags: [] }), // score 0
      bullet({ id: "s3", text: "Fixed CSS", tags: [] }), // score 0
    ];

    const result = await selectRelevantBullets(jobSignals, profile(bullets), {
      maxPerRole: 2,
      minPerRole: 2,
      spareCount: 1,
    });

    expect(result).toHaveLength(3); // 2 primaries + 1 spare
    expect(result.filter((b) => !b.isSpare).map((b) => b.bulletId)).toEqual(["p1", "p2"]);
    expect(result.filter((b) => b.isSpare).map((b) => b.bulletId)).toEqual(["s1"]); // next-highest-ranked
  });

  it("defaults spareCount to 2", async () => {
    const { selectRelevantBullets } = await import("./tailoring-pipeline.js");
    const bullets = Array.from({ length: 6 }, (_, i) => bullet({ id: `b${i}`, text: `Fixed bug ${i}`, tags: [] }));

    const result = await selectRelevantBullets(jobSignals, profile(bullets), { maxPerRole: 3, minPerRole: 3 });
    expect(result.filter((b) => b.isSpare)).toHaveLength(2);
  });
});

describe("rephraseSelectedBullets", () => {
  it("maps rewrites back onto the original selected bullets by id", async () => {
    messagesCreate.mockResolvedValue(
      toolResponse("record_rewrites", {
        rewrites: [{ id: "b1", rewritten_text: "Cut incident time by fixing a Go race condition" }],
      }),
    );

    const { rephraseSelectedBullets } = await import("./tailoring-pipeline.js");
    const selected: SelectedBullet[] = [
      { experienceId: "role_a", bulletId: "b1", text: "Fixed a Go race condition", tags: ["Go"], score: 3, isSpare: false },
    ];

    const result = await rephraseSelectedBullets(selected, jobSignals);
    expect(result).toEqual([
      {
        bulletId: "b1",
        experienceId: "role_a",
        originalText: "Fixed a Go race condition",
        rewrittenText: "Cut incident time by fixing a Go race condition",
      },
    ]);
  });

  it("short-circuits without calling the model when there are no selected bullets", async () => {
    const { rephraseSelectedBullets } = await import("./tailoring-pipeline.js");
    const result = await rephraseSelectedBullets([], jobSignals);
    expect(result).toEqual([]);
    expect(messagesCreate).not.toHaveBeenCalled();
  });
});

describe("auditRewrite", () => {
  it("passes a rewrite that only reorders/rewords the original facts", async () => {
    const { auditRewrite } = await import("./tailoring-pipeline.js");
    const rewrite: RewrittenBullet = {
      bulletId: "b1",
      experienceId: "role_a",
      originalText: "Fixed a race condition affecting 1,000 users using Go",
      rewrittenText: "Resolved a Go race condition impacting 1,000 users",
    };
    expect(auditRewrite(rewrite, ["Go"])).toEqual([]);
  });

  it("flags a hallucinated tool not present in the original text or tags", async () => {
    const { auditRewrite } = await import("./tailoring-pipeline.js");
    const rewrite: RewrittenBullet = {
      bulletId: "b1",
      experienceId: "role_a",
      originalText: "Fixed a race condition affecting 1,000 users",
      rewrittenText: "Fixed a Kubernetes race condition affecting 1,000 users",
    };
    const flags = auditRewrite(rewrite, ["Go"]);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.reason).toContain("Kubernetes");
  });

  it("flags a fabricated metric not present in the original", async () => {
    const { auditRewrite } = await import("./tailoring-pipeline.js");
    const rewrite: RewrittenBullet = {
      bulletId: "b1",
      experienceId: "role_a",
      originalText: "Fixed a race condition affecting 1,000 users",
      rewrittenText: "Fixed a race condition, boosting throughput by 40%",
    };
    const flags = auditRewrite(rewrite, []);
    expect(flags[0]!.reason).toContain("40%");
  });
});

const originalBullets: SelectedBullet[] = [
  { experienceId: "forty7", bulletId: "f1", text: "Fixed a signup bug", tags: ["NestJS"], score: 5, isSpare: false },
  { experienceId: "forty7", bulletId: "f2", text: "Built a tracking integration", tags: ["Angular"], score: 3, isSpare: false },
];
const rewrittenBullets: RewrittenBullet[] = [
  {
    bulletId: "f1",
    experienceId: "forty7",
    originalText: "Fixed a signup bug",
    // Hallucinates "Redis" — not in original text or tags.
    rewrittenText: "Fixed a signup bug using Redis",
  },
  {
    bulletId: "f2",
    experienceId: "forty7",
    originalText: "Built a tracking integration",
    rewrittenText: "Shipped a tracking integration in Angular",
  },
];

describe("verifyBullets", () => {
  it("passes clean rewrites straight through without a correction round-trip", async () => {
    messagesCreate.mockResolvedValueOnce(
      toolResponse("record_audit", {
        audits: [
          { id: "f1", flagged_claims: [] },
          { id: "f2", flagged_claims: [] },
        ],
      }),
    );

    const { verifyBullets } = await import("./tailoring-pipeline.js");
    const result = await verifyBullets(originalBullets, rewrittenBullets);

    expect(messagesCreate).toHaveBeenCalledTimes(1); // no correction pass needed
    expect(result.every((v) => v.verified && !v.usedFallback)).toBe(true);
    expect(result.find((v) => v.bulletId === "f2")?.finalText).toBe(
      "Shipped a tracking integration in Angular",
    );
  });

  it("accepts a corrected rewrite once it clears re-audit", async () => {
    messagesCreate
      .mockResolvedValueOnce(
        toolResponse("record_audit", {
          audits: [
            { id: "f1", flagged_claims: ["Redis"] },
            { id: "f2", flagged_claims: [] },
          ],
        }),
      )
      .mockResolvedValueOnce(
        toolResponse("record_corrections", {
          corrections: [{ id: "f1", corrected_text: "Fixed a signup bug" }],
        }),
      )
      .mockResolvedValueOnce(
        toolResponse("record_audit", { audits: [{ id: "f1", flagged_claims: [] }] }),
      );

    const { verifyBullets } = await import("./tailoring-pipeline.js");
    const result = await verifyBullets(originalBullets, rewrittenBullets);

    expect(messagesCreate).toHaveBeenCalledTimes(3);
    const f1 = result.find((v) => v.bulletId === "f1")!;
    expect(f1.usedFallback).toBe(false);
    expect(f1.finalText).toBe("Fixed a signup bug");
  });

  it("falls back to the original bullet text when the correction still fails audit", async () => {
    messagesCreate
      .mockResolvedValueOnce(
        toolResponse("record_audit", { audits: [{ id: "f1", flagged_claims: ["Redis"] }] }),
      )
      .mockResolvedValueOnce(
        toolResponse("record_corrections", {
          corrections: [{ id: "f1", corrected_text: "Fixed a signup bug using a cache layer" }],
        }),
      )
      .mockResolvedValueOnce(
        toolResponse("record_audit", { audits: [{ id: "f1", flagged_claims: ["cache layer"] }] }),
      );

    const { verifyBullets } = await import("./tailoring-pipeline.js");
    const result = await verifyBullets([originalBullets[0]!], [rewrittenBullets[0]!]);

    expect(result[0]!.usedFallback).toBe(true);
    expect(result[0]!.finalText).toBe("Fixed a signup bug");
    // Reports the CURRENT unresolved issue from the re-audit ("cache
    // layer" — what correction left behind), not the stale first-pass flag
    // ("Redis") that correction already addressed.
    expect(result[0]!.flaggedClaims).toContain("cache layer");
  });
});

function makeProfile(): Profile {
  return {
    personal_info: { name: "Test Candidate" },
    education: [],
    technical_skills: {
      languages: ["TypeScript", "Java"],
      frameworks_libraries: ["NestJS", "Angular"],
    },
    experiences: [
      {
        id: "forty7",
        type: "work",
        company: "Forty7",
        role: "Software Developer Co-op",
        location: "New York, NY",
        dates: "Jan 2026 -- May 2026",
        bullets: [],
      },
      {
        id: "njit_ra",
        type: "work",
        company: "New Jersey Institute of Technology",
        role: "Research Assistant",
        location: "Newark, NJ",
        dates: "Apr 2025 -- Sep 2025",
        bullets: [],
      },
      {
        id: "bnp_paribas",
        type: "work",
        company: "BNP Paribas",
        role: "Software Engineer Intern",
        location: "Mumbai, India",
        dates: "Jan 2024 -- Jul 2024",
        bullets: [],
      },
    ],
  };
}

describe("auditAndCompile", () => {
  it("reverts flagged bullets to original text and injects clean ones into the real template", async () => {
    messagesCreate
      .mockResolvedValueOnce(
        toolResponse("record_audit", {
          audits: [
            { id: "f1", flagged_claims: ["Redis"] },
            { id: "f2", flagged_claims: [] },
          ],
        }),
      )
      .mockResolvedValueOnce(
        toolResponse("record_corrections", {
          corrections: [{ id: "f1", corrected_text: "Fixed a signup bug using Redis again" }],
        }),
      )
      .mockResolvedValueOnce(
        toolResponse("record_audit", { audits: [{ id: "f1", flagged_claims: ["Redis"] }] }),
      )
      .mockResolvedValueOnce(
        toolResponse("record_summary", {
          summary: "Backend engineer experienced with TypeScript and NestJS across production systems.",
        }),
      );

    const { auditAndCompile } = await import("./tailoring-pipeline.js");
    const result = await auditAndCompile(
      rewrittenBullets,
      originalBullets,
      makeProfile(),
      jobSignals,
      REAL_TEMPLATE_PATH,
    );

    expect(result.flaggedBulletIds).toEqual(["f1"]);
    expect(result.warnings[0]).toContain("Redis");
    // Flagged bullet reverted to its original text in the compiled output...
    expect(result.content).toContain("Fixed a signup bug");
    expect(result.content).not.toContain("Redis");
    // ...clean bullet's rewrite made it through.
    expect(result.content).toContain("Shipped a tracking integration in Angular");
    // Summary and skills got filled in, not left as literal tokens.
    expect(result.content).toContain("Backend engineer experienced with TypeScript and NestJS");
    expect(result.content).toContain("\\textbf{Languages}{: TypeScript, Java}");
    // No unfilled {{...}} placeholders anywhere in the compiled output.
    expect(result.content).not.toMatch(/\{\{[A-Z_]+\}\}/);
    // No empty \resumeItem{} — every rendered bullet slot has text or the
    // block itself is simply omitted (no bullets selected for that role in
    // this narrow fixture, which only supplies Forty7 bullets).
    expect(result.content).not.toMatch(/\\resumeItem\{\}/);
    // Template scaffolding untouched.
    expect(result.content).toContain("\\resumeExpHeading");
  });
});

describe("rephraseSelectedBullets — robustness", () => {
  it("pass-through fallback: a bullet the model's response omits still comes out 1:1", async () => {
    const selected: SelectedBullet[] = [
      { experienceId: "role_a", bulletId: "kept", text: "Fixed a Go bug", tags: ["Go"], score: 3, isSpare: false },
      { experienceId: "role_a", bulletId: "dropped", text: "Built a Go service", tags: ["Go"], score: 2, isSpare: false },
    ];
    // Model only returns a rewrite for "kept" — "dropped" is missing from the response.
    messagesCreate.mockResolvedValueOnce(
      toolResponse("record_rewrites", { rewrites: [{ id: "kept", rewritten_text: "Resolved a Go bug" }] }),
    );

    const { rephraseSelectedBullets } = await import("./tailoring-pipeline.js");
    const result = await rephraseSelectedBullets(selected, jobSignals);

    expect(result).toHaveLength(2);
    const dropped = result.find((r) => r.bulletId === "dropped")!;
    expect(dropped.rewrittenText).toBe("Built a Go service"); // pass-through of original, not lost
    const kept = result.find((r) => r.bulletId === "kept")!;
    expect(kept.rewrittenText).toBe("Resolved a Go bug");
  });
});

describe("isTechnicalProperNoun / buildStackLine — taxonomy filter", () => {
  const knownTech = new Set(["redis", "typescript", "docker"]);

  it("keeps technical proper nouns via the profile whitelist or shape heuristics", async () => {
    const { isTechnicalProperNoun } = await import("./tailoring-pipeline.js");
    expect(isTechnicalProperNoun("Redis", knownTech)).toBe(true); // whitelist match
    expect(isTechnicalProperNoun("GraphQL", knownTech)).toBe(true); // 2+ caps
    expect(isTechnicalProperNoun("Node.js", knownTech)).toBe(true); // punctuation
    expect(isTechnicalProperNoun("k6", knownTech)).toBe(true); // digit
    expect(isTechnicalProperNoun("reCAPTCHA", knownTech)).toBe(true); // lowercase->uppercase transition
    expect(isTechnicalProperNoun("Docker", knownTech)).toBe(true); // capitalized single word
    expect(isTechnicalProperNoun("REST API", knownTech)).toBe(true); // multi-word, every word tech-shaped
  });

  it("drops operational/domain phrases and bare lowercase concept words", async () => {
    const { isTechnicalProperNoun } = await import("./tailoring-pipeline.js");
    expect(isTechnicalProperNoun("guest access", knownTech)).toBe(false);
    expect(isTechnicalProperNoun("bug fix", knownTech)).toBe(false);
    expect(isTechnicalProperNoun("root cause analysis", knownTech)).toBe(false);
    expect(isTechnicalProperNoun("authorization", knownTech)).toBe(false);
    expect(isTechnicalProperNoun("concurrency", knownTech)).toBe(false);
  });

  it("buildStackLine filters tags to technical proper nouns only, deduped, in order", async () => {
    const { buildStackLine } = await import("./tailoring-pipeline.js");
    const bullets = [
      { tags: ["Angular", "guest access", "auth flow"] },
      { tags: ["NestJS", "Angular", "ticket tracking"] },
    ];
    expect(buildStackLine(bullets, new Set())).toBe("Angular, NestJS");
  });
});

describe("verifyBullets — word-count guardrail", () => {
  it("flags a factually-clean but over-28-word rewrite and sends it through correction", async () => {
    const original: SelectedBullet[] = [
      {
        experienceId: "role_a",
        bulletId: "long1",
        text: "Fixed a race condition affecting production traffic across the NestJS proxy bidding service",
        tags: ["NestJS"],
        score: 3,
        isSpare: false,
      },
    ];
    const wordyRewrite =
      "Resolved a critical concurrency race condition impacting live production traffic across the NestJS proxy bidding service by adding careful synchronization"; // 20 words... construct to exceed 28
    const reallyWordyRewrite = `${wordyRewrite} and thorough validation checks throughout the entire request lifecycle end to end`; // pushes over 28
    const rewritten: RewrittenBullet[] = [
      { bulletId: "long1", experienceId: "role_a", originalText: original[0]!.text, rewrittenText: reallyWordyRewrite },
    ];

    messagesCreate
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "long1", flagged_claims: [] }] })) // factually clean
      .mockResolvedValueOnce(
        toolResponse("record_corrections", {
          corrections: [{ id: "long1", corrected_text: "Fixed a NestJS proxy bidding race condition impacting live production traffic" }],
        }),
      )
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "long1", flagged_claims: [] }] }));

    const { verifyBullets } = await import("./tailoring-pipeline.js");
    const result = await verifyBullets(original, rewritten);

    expect(messagesCreate).toHaveBeenCalledTimes(3); // audit -> correction -> re-audit, triggered by length alone
    expect(result[0]!.finalText).toBe("Fixed a NestJS proxy bidding race condition impacting live production traffic");
    expect(result[0]!.usedFallback).toBe(false);
  });

  it("falls back to the original when the correction is still over the word limit", async () => {
    const original: SelectedBullet[] = [
      { experienceId: "role_a", bulletId: "long1", text: "Short original text", tags: [], score: 1, isSpare: false },
    ];
    const wordy = Array.from({ length: 35 }, (_, i) => `word${i}`).join(" ");
    const stillWordy = Array.from({ length: 30 }, (_, i) => `fix${i}`).join(" ");
    const rewritten: RewrittenBullet[] = [
      { bulletId: "long1", experienceId: "role_a", originalText: "Short original text", rewrittenText: wordy },
    ];

    messagesCreate
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "long1", flagged_claims: [] }] }))
      .mockResolvedValueOnce(toolResponse("record_corrections", { corrections: [{ id: "long1", corrected_text: stillWordy }] }))
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "long1", flagged_claims: [] }] }));

    const { verifyBullets } = await import("./tailoring-pipeline.js");
    const result = await verifyBullets(original, rewritten);

    expect(result[0]!.usedFallback).toBe(true);
    expect(result[0]!.finalText).toBe("Short original text");
    expect(result[0]!.flaggedClaims[0]).toContain("28-word limit");
  });
});

describe("bannedAngleFlags", () => {
  it("flags ticket/bug-count framing", async () => {
    const { bannedAngleFlags } = await import("./tailoring-pipeline.js");
    const flags = bannedAngleFlags("Resolved 10-12 Jiras across backend, frontend, and CSS");
    expect(flags[0]).toContain("ticket/bug-count framing");
  });

  it("flags agile ceremony framing", async () => {
    const { bannedAngleFlags } = await import("./tailoring-pipeline.js");
    const flags = bannedAngleFlags("Participated in sprint planning, daily standups, retrospectives");
    expect(flags[0]).toContain("agile ceremony framing");
  });

  it("flags passive codebase exploration", async () => {
    const { bannedAngleFlags } = await import("./tailoring-pipeline.js");
    const flags = bannedAngleFlags("Studied provided backend code to understand data shapes and API contracts");
    expect(flags[0]).toContain("passive codebase exploration");
  });

  it("flags meta-prompt/rulebook descriptions", async () => {
    const { bannedAngleFlags } = await import("./tailoring-pipeline.js");
    const flags = bannedAngleFlags("Backend runs a markdown rulebook encoding hard anti-fabrication boundaries");
    expect(flags[0]).toContain("meta-prompt/rulebook description");
  });

  it("does not flag a clean, technical-work-centered bullet", async () => {
    const { bannedAngleFlags } = await import("./tailoring-pipeline.js");
    expect(bannedAngleFlags("Cut duplicate-bid errors to zero by adding a per-lot job queue to the NestJS service")).toEqual(
      [],
    );
  });
});

describe("bulletDensityFlags", () => {
  it("flags a bullet that spills onto a mostly-empty second line", async () => {
    const { bulletDensityFlags } = await import("./tailoring-pipeline.js");
    const spillover = "x".repeat(110); // > 95, < ceil(95*1.5)=143
    expect(bulletDensityFlags(spillover)[0]).toContain("bad density");
  });

  it("does not flag a bullet that fits on one line", async () => {
    const { bulletDensityFlags } = await import("./tailoring-pipeline.js");
    expect(bulletDensityFlags("x".repeat(80))).toEqual([]);
  });

  it("does not flag a bullet long enough to fill a second line well", async () => {
    const { bulletDensityFlags } = await import("./tailoring-pipeline.js");
    expect(bulletDensityFlags("x".repeat(150))).toEqual([]);
  });
});

describe("numberDensityCheck", () => {
  it("warns when a role's shipped bullets contain zero digits", async () => {
    const { numberDensityCheck } = await import("./tailoring-pipeline.js");
    const warnings: string[] = [];
    numberDensityCheck("bnp_paribas", ["Built a feature", "Fixed a bug"], warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("bnp_paribas");
  });

  it("does not warn when at least one bullet has a digit", async () => {
    const { numberDensityCheck } = await import("./tailoring-pipeline.js");
    const warnings: string[] = [];
    numberDensityCheck("bnp_paribas", ["Built a feature", "Led a 12-person team"], warnings);
    expect(warnings).toEqual([]);
  });

  it("does not warn on an empty role (nothing shipped)", async () => {
    const { numberDensityCheck } = await import("./tailoring-pipeline.js");
    const warnings: string[] = [];
    numberDensityCheck("bnp_paribas", [], warnings);
    expect(warnings).toEqual([]);
  });
});

describe("verifyBullets — banned-angle handling", () => {
  it("marks a bullet unusable (not reverted) when a banned-angle violation survives correction", async () => {
    const original: SelectedBullet[] = [
      {
        experienceId: "bnp",
        bulletId: "b1",
        text: "Worked on 10-12 Jiras across 5 months: backend, frontend, and CSS fixes",
        tags: [],
        score: 2,
        isSpare: false,
      },
    ];
    const rewritten: RewrittenBullet[] = [
      {
        bulletId: "b1",
        experienceId: "bnp",
        originalText: original[0]!.text,
        // Pass-through fallback shipped the original verbatim — it's already a banned-angle violation.
        rewrittenText: original[0]!.text,
      },
    ];

    messagesCreate
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "b1", flagged_claims: [] }] })) // factually clean
      .mockResolvedValueOnce(
        toolResponse("record_corrections", {
          // Correction attempt doesn't actually reframe it — still ticket-count-centered.
          corrections: [{ id: "b1", corrected_text: "Resolved 10-12 Jiras across backend and frontend" }],
        }),
      )
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "b1", flagged_claims: [] }] }));

    const { verifyBullets } = await import("./tailoring-pipeline.js");
    const result = await verifyBullets(original, rewritten);

    expect(result[0]!.unusable).toBe(true);
    expect(result[0]!.usedFallback).toBe(false); // NOT reverted to original — original IS the violation
    expect(result[0]!.verified).toBe(false);
    expect(result[0]!.flaggedClaims[0]).toContain("banned angle");
  });

  it("accepts a correction that successfully reframes away from the banned angle", async () => {
    const original: SelectedBullet[] = [
      {
        experienceId: "bnp",
        bulletId: "b1",
        text: "Worked on 10-12 Jiras across 5 months: backend, frontend, and CSS fixes",
        tags: [],
        score: 2,
        isSpare: false,
      },
    ];
    const rewritten: RewrittenBullet[] = [
      { bulletId: "b1", experienceId: "bnp", originalText: original[0]!.text, rewrittenText: original[0]!.text },
    ];

    messagesCreate
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "b1", flagged_claims: [] }] }))
      .mockResolvedValueOnce(
        toolResponse("record_corrections", {
          corrections: [
            {
              id: "b1",
              corrected_text: "Shipped backend, frontend, and CSS fixes across a Java Spring Boot migration over 5 months",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "b1", flagged_claims: [] }] }));

    const { verifyBullets } = await import("./tailoring-pipeline.js");
    const result = await verifyBullets(original, rewritten);

    expect(result[0]!.unusable).toBe(false);
    expect(result[0]!.usedFallback).toBe(false);
    expect(result[0]!.verified).toBe(true);
    expect(result[0]!.finalText).toContain("Java Spring Boot migration");
  });
});

describe("auditAndCompile — backfill from spares on unusable bullet", () => {
  it("drops an unusable primary and promotes a spare to fill its slot", async () => {
    const originalBullets: SelectedBullet[] = [
      { experienceId: "forty7", bulletId: "p1", text: "Fixed a signup bug in NestJS", tags: ["NestJS"], score: 5, isSpare: false },
      {
        experienceId: "forty7",
        bulletId: "p2",
        text: "Worked on 10-12 Jiras across backend and frontend",
        tags: [],
        score: 4,
        isSpare: false,
      },
      {
        experienceId: "forty7",
        bulletId: "spare1",
        text: "Built a tracking integration in Angular",
        tags: ["Angular"],
        score: 3,
        isSpare: true,
      },
    ];
    const rewrittenBullets: RewrittenBullet[] = originalBullets.map((b) => ({
      bulletId: b.bulletId,
      experienceId: b.experienceId,
      originalText: b.text,
      rewrittenText: b.text, // pass-through — p2's banned angle rides along unrewritten
    }));

    messagesCreate
      // First audit pass over all 3 bullets — factually clean.
      .mockResolvedValueOnce(
        toolResponse("record_audit", {
          audits: originalBullets.map((b) => ({ id: b.bulletId, flagged_claims: [] })),
        }),
      )
      // Correction attempt for p2 (the only one with a first-pass flag —
      // the deterministic banned-angle check) fails to actually reframe it.
      .mockResolvedValueOnce(
        toolResponse("record_corrections", {
          corrections: [{ id: "p2", corrected_text: "Resolved 10-12 Jiras across backend and frontend" }],
        }),
      )
      .mockResolvedValueOnce(toolResponse("record_audit", { audits: [{ id: "p2", flagged_claims: [] }] }))
      .mockResolvedValueOnce(
        toolResponse("record_summary", {
          summary: "B.S. Computer Science graduate specializing in TypeScript and NestJS. Builds full-stack production systems end to end.",
        }),
      );

    const { auditAndCompile } = await import("./tailoring-pipeline.js");
    const result = await auditAndCompile(rewrittenBullets, originalBullets, makeProfile(), jobSignals, REAL_TEMPLATE_PATH);

    expect(result.flaggedBulletIds).toContain("p2");
    expect(result.warnings.some((w) => w.includes("dropped bullet p2"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("backfilled 1 bullet(s) from spares"))).toBe(true);

    // p2's violation never shipped...
    expect(result.content).not.toContain("Jiras");
    // ...but the role still got its full bullet count via the spare.
    expect(result.content).toContain("Fixed a signup bug in NestJS");
    expect(result.content).toContain("Built a tracking integration in Angular");
  });
});

describe("generateSummary — structure, job-title guard, and buzzword guard", () => {
  function profile(): Profile {
    return {
      personal_info: {},
      education: [{ institution: "State University", degree: "B.S. Computer Science", status: "Completed" }],
      technical_skills: { languages: ["TypeScript", "Python"] },
      experiences: [
        {
          id: "role_a",
          type: "work",
          company: "Acme",
          role: "Software Engineer",
          location: null,
          dates: "2024",
          bullets: [],
        },
      ],
    };
  }

  it("passes through a clean, compliant summary that opens with the degree, not a job title", async () => {
    messagesCreate.mockResolvedValueOnce(
      toolResponse("record_summary", {
        summary:
          "B.S. Computer Science graduate specializing in TypeScript and Python. Builds full-stack production systems end to end. Ships features across web and backend services.",
      }),
    );
    const { generateSummary } = await import("./tailoring-pipeline.js");
    const result = await generateSummary(profile(), jobSignals);
    expect(result).toContain("Builds full-stack production systems");
  });

  it("falls back when the summary opens with a job title from the profile — the actual root cause, not just prompt wording", async () => {
    messagesCreate.mockResolvedValueOnce(
      toolResponse("record_summary", {
        summary: "Software Engineer with a degree in Computer Science. Builds full-stack production systems end to end.",
      }),
    );
    const { generateSummary } = await import("./tailoring-pipeline.js");
    const result = await generateSummary(profile(), jobSignals);
    expect(result.startsWith("Software Engineer")).toBe(false);
    expect(result).toContain("B.S. Computer Science graduate"); // deterministic fallback opens with the degree
  });

  it("falls back when the summary contains a banned buzzword", async () => {
    messagesCreate.mockResolvedValueOnce(
      toolResponse("record_summary", {
        summary: "Results-oriented graduate specializing in TypeScript. Passionate developer who ships production systems.",
      }),
    );
    const { generateSummary } = await import("./tailoring-pipeline.js");
    const result = await generateSummary(profile(), jobSignals);
    expect(result).not.toContain("Results-oriented");
  });

  it("falls back when the summary exceeds 70 words", async () => {
    const overlong = Array.from({ length: 75 }, (_, i) => `word${i}`).join(" ");
    messagesCreate.mockResolvedValueOnce(toolResponse("record_summary", { summary: overlong }));
    const { generateSummary } = await import("./tailoring-pipeline.js");
    const result = await generateSummary(profile(), jobSignals);
    expect(result).not.toBe(overlong);
  });

  it("falls back when the summary names a specific employer from the profile", async () => {
    messagesCreate.mockResolvedValueOnce(
      toolResponse("record_summary", {
        summary: "B.S. Computer Science graduate with experience at Acme. Ships full-stack production systems end to end.",
      }),
    );
    const { generateSummary } = await import("./tailoring-pipeline.js");
    const result = await generateSummary(profile(), jobSignals);
    expect(result).not.toContain("Acme");
  });

  it("falls back when the summary uses a newly-banned buzzword (comfortable debugging / hands-on experience across)", async () => {
    messagesCreate.mockResolvedValueOnce(
      toolResponse("record_summary", {
        summary: "B.S. Computer Science graduate with hands-on experience across TypeScript and Python. Comfortable debugging production issues end to end.",
      }),
    );
    const { generateSummary } = await import("./tailoring-pipeline.js");
    const result = await generateSummary(profile(), jobSignals);
    expect(result).not.toContain("hands-on experience across");
    expect(result).not.toContain("Comfortable debugging");
  });

  it("deterministic fallback opens with degree + institution, never the retired 'hands-on experience across' phrasing, and stays under 70 words", async () => {
    messagesCreate.mockRejectedValueOnce(new Error("network error"));
    const { generateSummary } = await import("./tailoring-pipeline.js");
    const result = await generateSummary(profile(), jobSignals);
    expect(result).not.toContain("hands-on experience across");
    expect(result).toContain("B.S. Computer Science graduate from State University");
    expect(result.split(/\s+/).filter(Boolean).length).toBeLessThan(70);
  });
});

describe("pre-compile validators", () => {
  it("checkBulletCount warns when a role falls outside 2-3 bullets", async () => {
    const { checkBulletCount } = await import("./tailoring-pipeline.js");
    const warnings: string[] = [];
    checkBulletCount("forty7", 1, warnings);
    checkBulletCount("njit_ra", 3, warnings); // in range, no warning
    checkBulletCount("bnp_paribas", 5, warnings);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("forty7");
    expect(warnings[1]).toContain("bnp_paribas");
  });

  it("assertNoLeftoverPlaceholders throws when a {{TOKEN}} survives compilation", async () => {
    const { assertNoLeftoverPlaceholders } = await import("./tailoring-pipeline.js");
    expect(() => assertNoLeftoverPlaceholders("some text {{SUMMARY}} more text")).toThrow(/SUMMARY/);
    expect(() => assertNoLeftoverPlaceholders("clean compiled output")).not.toThrow();
  });
});
