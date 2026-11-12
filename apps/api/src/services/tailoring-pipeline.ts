import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { parse as parseYaml } from "yaml";
import { getConfig } from "../config.js";

/**
 * Four-step resume-tailoring pipeline, replacing the single agentic
 * query()-loop pass in claude-agent.ts with discrete, testable functions:
 *
 *   1. extractJobSignals   — 1 LLM call.  JD text -> typed JobSignals.
 *   2. selectRelevantBullets — deterministic scoring, no LLM call. Ranks
 *      profile.yaml bullets against JobSignals, returns ids only.
 *   3. rephraseSelectedBullets — 1 LLM call. Rewrites selected bullet text.
 *   4. auditAndCompile — runs the strict LLM critic (verifyBullets, below)
 *      over every rewrite, derives each role's stack line and a JD-reordered
 *      skills block, generates the summary, and compiles the full document
 *      into templates/resume-template.tex's {{TOKEN}} placeholders — no
 *      empty \resumeItem{} lines or leftover {{...}} markers ever ship.
 *
 * Selection stays deterministic on purpose — profile.yaml bullets carry
 * structured tags to score against, so a model call there would be slower
 * and harder to test for no accuracy benefit. It also guarantees a minimum
 * bullet count per role (see SelectBulletsOptions.minPerRole): the template
 * shows a fixed heading for Forty7/NJIT/BNP unconditionally, so a role with
 * zero JD overlap still needs 2-3 bullets under it, backfilled by rank
 * rather than left empty.
 *
 * Auditing is the opposite of selection: a regex/token check (still
 * exported as auditRewrite, for callers that want a zero-network-cost
 * sanity check) can catch an obviously new tool name or number, but it
 * can't catch a paraphrased, unsupported responsibility claim ("led the
 * migration") — that needs a reader that understands meaning, not shape.
 * verifyBullets is that reader: it audits every rewrite, attempts one
 * strict correction for anything flagged, re-audits the correction, and
 * falls back to the original bullet text — the only text guaranteed 100%
 * truthful — for anything still unverified.
 *
 * Template placeholder scheme: one {{X}} token per role's bullet block and
 * stack line (e.g. {{FORTY7_BULLETS}}, {{FORTY7_STACK}}), plus {{SUMMARY}}
 * and {{SKILLS_CATEGORIES}} — see compileTemplate. This replaced the old
 * per-bullet SLOT-BULLET-1/2/3 markers, which could only ever hold exactly
 * three bullets and rendered `\resumeItem{}` empty when a role scored zero
 * bullets under the old selection default.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JobSignals {
  primary_tech: string[];
  secondary_tech: string[];
  core_responsibilities: string[];
  domain_keywords: string[];
}

export interface ProfileBullet {
  id: string;
  text: string;
  tags: string[];
  core_action: string;
}

export interface ProfileExperience {
  id: string;
  type: "work" | "project";
  company: string | null;
  role: string;
  location: string | null;
  dates: string;
  bullets: ProfileBullet[];
}

export interface EducationEntry {
  institution?: string;
  degree?: string;
  status?: string;
  date?: string;
  gpa?: number;
}

export interface Profile {
  personal_info: Record<string, unknown>;
  education: EducationEntry[];
  technical_skills: Record<string, string[]>;
  experiences: ProfileExperience[];
}

/** Output of step 2 — id + enough context (text, tags, score) for steps 3-4 to work without re-reading the profile. */
export interface SelectedBullet {
  experienceId: string;
  bulletId: string;
  text: string;
  tags: string[];
  score: number;
  /** True for a spare beyond the primary maxPerRole slots — carried through rewrite/verify like any other bullet, but only used to backfill a primary that turns out unusable (see auditAndCompile). */
  isSpare: boolean;
}

export interface RewrittenBullet {
  bulletId: string;
  experienceId: string;
  originalText: string;
  rewrittenText: string;
}

export interface AuditFlag {
  bulletId: string;
  reason: string;
}

export interface CompiledResume {
  content: string;
  warnings: string[];
  /** Bullet ids the critic flagged and reverted to original text. */
  flaggedBulletIds: string[];
}

// ---------------------------------------------------------------------------
// Anthropic client + structured-output helper
// ---------------------------------------------------------------------------

let cachedClient: Anthropic | undefined;

function getClient(): Anthropic {
  cachedClient ??= new Anthropic({ apiKey: getConfig().anthropicApiKey });
  return cachedClient;
}

/**
 * Forces a single structured JSON response via tool_choice, instead of
 * asking Claude to emit JSON in a text block and parsing it — avoids the
 * usual failure modes (markdown code fences, leading/trailing prose,
 * truncated JSON) that free-text parsing is prone to.
 */
async function callForJson<T>(params: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Anthropic.Tool.InputSchema;
  model?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const response = await getClient().messages.create(
    {
      model: params.model ?? "claude-sonnet-5",
      max_tokens: 4096,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
      tools: [
        {
          name: params.toolName,
          description: params.toolDescription,
          input_schema: params.schema,
        },
      ],
      tool_choice: { type: "tool", name: params.toolName },
    },
    { signal: params.signal },
  );

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(
      `Expected a "${params.toolName}" tool call, got: ${JSON.stringify(response.content)}`,
    );
  }
  return toolUse.input as T;
}

// ---------------------------------------------------------------------------
// Step 1 — extractJobSignals
// ---------------------------------------------------------------------------

export const JOB_SIGNALS_SYSTEM_PROMPT = `You are a precise job-description parser for a resume-tailoring pipeline.

Extract ONLY what the job description literally states or unambiguously implies. Do not infer skills the JD doesn't mention. Do not editorialize or add commentary.

Definitions:
- primary_tech: languages, frameworks, and tools the JD names as required or emphasizes repeatedly (appears in a "Requirements"/"Must have" section, or is named 2+ times).
- secondary_tech: languages, frameworks, and tools mentioned once, in passing, or explicitly framed as "nice to have" / "a plus" / "bonus".
- core_responsibilities: the 3-6 main duties of the role, written as short action phrases (e.g. "design and test software", "root-cause production issues"), not copied verbatim from the JD.
- domain_keywords: non-tech terms that matter for ATS/recruiter matching — methodology (Agile, SDLC), business domain (fintech, e-commerce), soft skills the JD explicitly calls out, seniority/education requirements (STEM Master's, GPA minimum).

Call the record_job_signals tool exactly once with your result. Any array may be empty if the JD genuinely has nothing for that category — never pad a category with invented items just to fill it.`;

export function buildJobSignalsUserPrompt(jobDescriptionText: string): string {
  return `Job description:\n---\n${jobDescriptionText}\n---`;
}

const JOB_SIGNALS_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    primary_tech: { type: "array", items: { type: "string" } },
    secondary_tech: { type: "array", items: { type: "string" } },
    core_responsibilities: { type: "array", items: { type: "string" } },
    domain_keywords: { type: "array", items: { type: "string" } },
  },
  required: ["primary_tech", "secondary_tech", "core_responsibilities", "domain_keywords"],
};

export async function extractJobSignals(
  jobDescriptionText: string,
  signal?: AbortSignal,
): Promise<JobSignals> {
  return callForJson<JobSignals>({
    system: JOB_SIGNALS_SYSTEM_PROMPT,
    user: buildJobSignalsUserPrompt(jobDescriptionText),
    toolName: "record_job_signals",
    toolDescription: "Records the structured signals extracted from a job description.",
    schema: JOB_SIGNALS_SCHEMA,
    signal,
  });
}

// ---------------------------------------------------------------------------
// Step 2 — selectRelevantBullets (deterministic, no LLM call)
// ---------------------------------------------------------------------------

export async function loadProfile(profileYamlPath: string): Promise<Profile> {
  const raw = await fs.readFile(profileYamlPath, "utf8");
  return parseYaml(raw) as Profile;
}

function normalizeToken(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9+.#]/g, "");
}

function tokenize(...values: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const word of value.split(/\s+/)) {
      const token = normalizeToken(word);
      if (token.length > 1) tokens.add(token);
    }
  }
  return tokens;
}

function hasAnyToken(phrase: string, tokens: Set<string>): boolean {
  for (const token of tokenize(phrase)) {
    if (tokens.has(token)) return true;
  }
  return false;
}

/**
 * Weighted overlap between a bullet's own vocabulary (text + core_action +
 * tags) and the JD's signals. primary_tech hits count 3x, secondary_tech
 * 2x, domain/responsibility keyword hits 1x — mirrors how much each
 * category should move a bullet up the ranking.
 */
export function scoreBullet(bullet: ProfileBullet, signals: JobSignals): number {
  const bulletTokens = tokenize(bullet.text, bullet.core_action, ...bullet.tags);
  let score = 0;
  for (const tech of signals.primary_tech) {
    if (hasAnyToken(tech, bulletTokens)) score += 3;
  }
  for (const tech of signals.secondary_tech) {
    if (hasAnyToken(tech, bulletTokens)) score += 2;
  }
  for (const keyword of [...signals.domain_keywords, ...signals.core_responsibilities]) {
    if (hasAnyToken(keyword, bulletTokens)) score += 1;
  }
  return score;
}

export interface SelectBulletsOptions {
  /** Max primary bullets kept per experience, ranked by score. Default 3. */
  maxPerRole?: number;
  /**
   * Minimum bullets guaranteed per experience, backfilling with the next-
   * highest-ranked bullets (even score-0 ones) if fewer than this many
   * scored above zero. The compiled template shows a fixed heading for
   * every core role (Forty7, NJIT RA, BNP Paribas) unconditionally — a role
   * with zero JD overlap still needs bullets under it, or the template
   * renders empty \resumeItem{} lines. Default 2 ("2-3 bullets per role").
   * Set to 0 to only ever keep bullets that scored above zero.
   */
  minPerRole?: number;
  /**
   * Extra bullets selected beyond maxPerRole, marked isSpare, ranked
   * immediately after the primaries. verifyBullets can hit a bullet whose
   * ORIGINAL text is itself the problem (a banned angle like "resolved 10
   * Jiras" or "attended standups") — reverting to original doesn't fix
   * that, unlike a factual/length violation. Spares give auditAndCompile
   * something safe to promote instead of shipping the violation or leaving
   * the role short a bullet. Default 2.
   */
  spareCount?: number;
}

export async function selectRelevantBullets(
  jobSignals: JobSignals,
  profile: Profile,
  options: SelectBulletsOptions = {},
): Promise<SelectedBullet[]> {
  const maxPerRole = options.maxPerRole ?? 3;
  const minPerRole = options.minPerRole ?? 2;
  const spareCount = options.spareCount ?? 2;

  const selected: SelectedBullet[] = [];
  for (const experience of profile.experiences) {
    // Sorted descending by score, so every positive-score bullet already
    // sorts ahead of every zero-score one — taking the top `takeCount` of
    // this single sorted list gives "prefer relevant bullets, but backfill
    // with the next-best (possibly zero-score) ones to reach minPerRole"
    // without a separate backfill pass.
    const ranked = experience.bullets
      .map((bullet) => ({ bullet, score: scoreBullet(bullet, jobSignals) }))
      .sort((a, b) => b.score - a.score);

    // minPerRole backfills up to maxPerRole, never past it — an explicit
    // maxPerRole below the default minPerRole (e.g. a caller asking for
    // just 1) is a hard ceiling, not something minPerRole overrides.
    const positiveCount = ranked.filter((r) => r.score > 0).length;
    const positiveTake = Math.min(positiveCount, maxPerRole);
    const takeCount = Math.min(maxPerRole, ranked.length, Math.max(positiveTake, minPerRole));
    const spareTake = Math.min(ranked.length, takeCount + spareCount);

    ranked.slice(0, spareTake).forEach(({ bullet, score }, index) => {
      selected.push({
        experienceId: experience.id,
        bulletId: bullet.id,
        text: bullet.text,
        tags: bullet.tags,
        score,
        isSpare: index >= takeCount,
      });
    });
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Step 3 — rephraseSelectedBullets
// ---------------------------------------------------------------------------

export const REPHRASE_SYSTEM_PROMPT = `You rewrite resume bullets to align phrasing and action verbs with a target job's language. You do NOT change what happened. These rules are universal — they apply to any candidate profile and any target job, never tuned to one specific resume's wording.

Hard negative constraint — never violate this: do not add any tool, technology, metric, number, team size, or responsibility that is not already present in that bullet's ORIGINAL text. You may reword, reorder, and emphasize; you may translate an implementation detail into the equivalent plain-language term the JD uses ONLY when it names the exact same fact (e.g. "REST endpoints" -> "APIs" is fine; adding "Kubernetes" when the original never mentions it is not, even if the JD wants it). If in doubt, leave the fact out rather than guess. Truthfulness always outranks every style rule below — never pad, embellish, or stretch a fact just to hit a word count or fit the structure.

Universal bullet structure — every bullet follows this shape:
[Strong past-tense action verb] + [specific technical scope/system, naming the tools involved] + [result, optimization, or functional impact].
Example: "Cut duplicate-bid errors to zero by adding a per-lot job queue to the NestJS proxy-bidding service" — verb (Cut), scope (per-lot job queue, NestJS proxy-bidding service), impact (duplicate-bid errors to zero).

Length target: 18-26 words per bullet. Never exceed 28 words — if the truthful content genuinely needs more, cut connective phrasing, not facts.

Never write a bullet centered on a passive task or administrative log — reframe around what was actually built/fixed/delivered, or drop the bullet's angle entirely if the original genuinely has nothing else to offer:
- "Investigated/read existing code" -> reframe around the feature, contract, or architecture that resulted from it, not the reading itself.
- "Resolved N tickets/Jiras" -> reframe around the specific component, bug, or system improvement one of those tickets produced — never lead with the ticket count as the achievement.
- "Attended standups/sprint planning" -> discard this angle; lead with a technical deliverable from that period instead.

Style rules:
- Start with the outcome/result, not the process ("Cut X by doing Y", not "Worked on Y which cut X").
- One idea per bullet — no chained "A, then B, then C" lists.
- Use direct technical verbs (Built, Fixed, Designed, Reduced, Automated) — never corporate filler (leveraged, spearheaded, utilized, facilitated, championed).
- Every number, tool name, and scope word in your rewrite must also appear — verbatim or as an obvious synonym — in that bullet's original text.

Call the record_rewrites tool exactly once with the full set of rewrites, one entry per bullet id you were given.`;

export function buildRephraseUserPrompt(
  selectedBullets: SelectedBullet[],
  jobSignals: JobSignals,
): string {
  const bulletLines = selectedBullets
    .map((b) => `- id: ${b.bulletId}\n  original: ${b.text}`)
    .join("\n");
  return [
    `Target job signals:`,
    `Primary tech: ${jobSignals.primary_tech.join(", ") || "(none)"}`,
    `Secondary tech: ${jobSignals.secondary_tech.join(", ") || "(none)"}`,
    `Core responsibilities: ${jobSignals.core_responsibilities.join(", ") || "(none)"}`,
    `Domain keywords: ${jobSignals.domain_keywords.join(", ") || "(none)"}`,
    ``,
    `Bullets to rewrite:`,
    bulletLines,
  ].join("\n");
}

const REPHRASE_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    rewrites: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          rewritten_text: { type: "string" },
        },
        required: ["id", "rewritten_text"],
      },
    },
  },
  required: ["rewrites"],
};

export async function rephraseSelectedBullets(
  selectedBullets: SelectedBullet[],
  jobSignals: JobSignals,
  signal?: AbortSignal,
): Promise<RewrittenBullet[]> {
  if (selectedBullets.length === 0) return [];

  const { rewrites } = await callForJson<{
    rewrites: Array<{ id: string; rewritten_text: string }>;
  }>({
    system: REPHRASE_SYSTEM_PROMPT,
    user: buildRephraseUserPrompt(selectedBullets, jobSignals),
    toolName: "record_rewrites",
    toolDescription: "Records the rewritten bullet text for each input bullet id.",
    schema: REPHRASE_SCHEMA,
    signal,
  });

  const rewriteById = new Map(rewrites.map((r) => [r.id, r.rewritten_text]));
  // Iterate the INPUT list, not the model's response — guarantees exactly
  // one RewrittenBullet per selected bullet even if the model's response
  // omits an id (a bullet that just vanished here would silently break the
  // "every experience gets 2-3 bullets" guarantee downstream). A missing
  // rewrite falls back to a pass-through of the original text, which is
  // always truthful by construction.
  return selectedBullets.map((original) => ({
    bulletId: original.bulletId,
    experienceId: original.experienceId,
    originalText: original.text,
    rewrittenText: rewriteById.get(original.bulletId) ?? original.text,
  }));
}

// ---------------------------------------------------------------------------
// Step 4 — auditAndCompile (deterministic critic + template injection)
// ---------------------------------------------------------------------------

const NUMBER_CLAIM_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "percentage", regex: /\d+(?:\.\d+)?\s*%/g },
  { label: "dollar amount", regex: /\$\s?\d[\d,.]*[kKmMbB]?/g },
  { label: "large number", regex: /\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b/g },
  { label: "multiplier", regex: /\b\d+(?:\.\d+)?x\b/gi },
];

/**
 * Tech-ish tokens: capitalized words and identifiers with tech-like
 * punctuation (GPT-4o, CI/CD, Node.js). Heuristic, not exhaustive — this is
 * the "fast" critic, not a model call, so it trades recall for speed. False
 * positives fail safe: a flagged bullet reverts to its original text rather
 * than shipping an unverified claim.
 *
 * Sentence-initial position is excluded: a rewrite's first word is
 * capitalized by grammar ("Resolved a Go race condition..."), not because
 * it's a proper noun, and it shares its shape with real tech terms
 * (single capital + lowercase, same as "Kubernetes") — a shape-only regex
 * can't tell them apart, so position is the disambiguator.
 */
const TECH_TOKEN_REGEX = /\b[A-Z][a-zA-Z0-9.+#/-]{1,}\b/g;

function extractClaims(text: string): Set<string> {
  const claims = new Set<string>();
  for (const { regex } of NUMBER_CLAIM_PATTERNS) {
    for (const match of text.matchAll(regex)) claims.add(match[0].trim());
  }
  for (const match of text.matchAll(TECH_TOKEN_REGEX)) {
    if (match.index === 0) continue;
    claims.add(match[0].trim());
  }
  return claims;
}

/** Flags any claim (number, tool name) in the rewrite that can't be traced back to the original bullet text or its known tags. */
export function auditRewrite(rewrite: RewrittenBullet, tags: string[]): AuditFlag[] {
  const allowedText = `${rewrite.originalText} ${tags.join(" ")}`;
  const allowedTextLower = allowedText.toLowerCase();
  const newClaims = [...extractClaims(rewrite.rewrittenText)].filter(
    (claim) => !allowedTextLower.includes(claim.toLowerCase()),
  );
  if (newClaims.length === 0) return [];
  return [
    {
      bulletId: rewrite.bulletId,
      reason: `New claim(s) not traceable to original bullet or its tags: ${newClaims.join(", ")}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Strict LLM critic — verifyBullets
// ---------------------------------------------------------------------------

export interface VerifiedBullet {
  bulletId: string;
  experienceId: string;
  finalText: string;
  /** True once finalText has cleared an audit (either the rewrite passed first try, or a correction did). False when unusable. */
  verified: boolean;
  /** Claims/flags from the last check that produced this result. Empty when verified with no issues. */
  flaggedClaims: string[];
  /** True when finalText is the original bullet text because the rewrite (and its one correction attempt) still failed a factual/length/density check — reverting to original is always safe for these. */
  usedFallback: boolean;
  /**
   * True when the bullet still has an unresolved banned-angle violation
   * after correction. Reverting to original text is NOT safe here — the
   * original can itself be the violation (a ticket-count bullet is banned
   * whether or not it was ever rewritten). auditAndCompile must drop a
   * bullet marked unusable and backfill from a spare rather than ship
   * finalText.
   */
  unusable: boolean;
}

const AUDIT_SYSTEM_PROMPT = `You are a strict factual auditor for a resume-tailoring pipeline. You compare a REWRITTEN resume bullet against its ORIGINAL source bullet.

List every technical tool, technology, number/metric, or responsibility/scope claim stated in the REWRITTEN bullet that is NOT present — verbatim or as an unambiguous synonym — in the ORIGINAL bullet.

Be strict:
- A tool or technology name absent from the original is a violation, even if it's a reasonable guess for the domain.
- A number, percentage, or count absent from the original is a violation, even if it seems plausible.
- A responsibility or scope claim not supported by the original is a violation — e.g. "led", "owned solely", "architected", "managed a team of X" when the original doesn't say that.

Do NOT flag: paraphrasing, reordering, or a synonym for the exact same fact the original already states (e.g. "REST endpoints" for "REST APIs", "cut" for "reduced").

Call the record_audit tool exactly once with one entry per bullet id you were given. A bullet with no violations gets an empty flagged_claims array — never invent a violation to fill it.`;

function buildAuditUserPrompt(pairs: Array<{ id: string; original: string; rewritten: string }>): string {
  return pairs
    .map((p) => `- id: ${p.id}\n  original: ${p.original}\n  rewritten: ${p.rewritten}`)
    .join("\n");
}

const AUDIT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    audits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          flagged_claims: { type: "array", items: { type: "string" } },
        },
        required: ["id", "flagged_claims"],
      },
    },
  },
  required: ["audits"],
};

async function auditPass(
  pairs: Array<{ id: string; original: string; rewritten: string }>,
  signal?: AbortSignal,
): Promise<Map<string, string[]>> {
  if (pairs.length === 0) return new Map();
  const { audits } = await callForJson<{ audits: Array<{ id: string; flagged_claims: string[] }> }>({
    system: AUDIT_SYSTEM_PROMPT,
    user: buildAuditUserPrompt(pairs),
    toolName: "record_audit",
    toolDescription: "Records, per bullet id, any claims in the rewritten text not supported by the original.",
    schema: AUDIT_SCHEMA,
    signal,
  });
  return new Map(audits.map((a) => [a.id, a.flagged_claims]));
}

const CORRECTION_SYSTEM_PROMPT = `You are correcting resume bullets that failed validation. For each bullet you receive the ORIGINAL source text, a REWRITTEN version, and the specific problems flagged with it — each problem is one of: a factual violation (a claim not present in the original), a length violation (over the 28-word limit), a density violation (a length that leaves the bullet's second rendered line mostly empty), or a banned-angle violation (the bullet is centered on a low-signal framing: a ticket/Jira count, an agile ceremony, passive codebase exploration, or a meta-prompt/rulebook description).

For factual violations: rewrite using ONLY facts, tools, numbers, and scope words that appear in the ORIGINAL text. Remove every flagged claim entirely rather than approximating it with a different unverified guess.

For length/density violations: tighten to 18-26 words by cutting connective phrasing, not facts — never shorten by dropping the result/impact clause, since that's the part that makes the bullet worth reading. If the problem is that the bullet is too short, expand using only facts already present in the original text — never invent detail to pad it.

For banned-angle violations: reframe around the underlying technical work instead of the low-signal angle — a ticket count becomes the functional module or bug it touched; a meeting or reading pass becomes the deliverable that resulted from it; a meta-prompt description becomes the underlying pipeline architecture. If the original genuinely has no other angle to reframe around, it is correct to leave the violation only partially resolved rather than invent a new fact.

You may keep the rewrite's phrasing/verb style where it doesn't depend on a flagged claim. If almost nothing can be kept, it is correct to output something close to the original text.

Call the record_corrections tool exactly once with one entry per bullet id you were given.`;

function buildCorrectionUserPrompt(
  items: Array<{ id: string; original: string; rewritten: string; flaggedClaims: string[] }>,
): string {
  return items
    .map(
      (item) =>
        `- id: ${item.id}\n  original: ${item.original}\n  rewritten (flagged): ${item.rewritten}\n  flagged_claims: ${item.flaggedClaims.join(", ")}`,
    )
    .join("\n");
}

const CORRECTION_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          corrected_text: { type: "string" },
        },
        required: ["id", "corrected_text"],
      },
    },
  },
  required: ["corrections"],
};

async function correctionPass(
  items: Array<{ id: string; original: string; rewritten: string; flaggedClaims: string[] }>,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  if (items.length === 0) return new Map();
  const { corrections } = await callForJson<{
    corrections: Array<{ id: string; corrected_text: string }>;
  }>({
    system: CORRECTION_SYSTEM_PROMPT,
    user: buildCorrectionUserPrompt(items),
    toolName: "record_corrections",
    toolDescription: "Records a corrected bullet text for each flagged bullet id.",
    schema: CORRECTION_SCHEMA,
    signal,
  });
  return new Map(corrections.map((c) => [c.id, c.corrected_text]));
}

/**
 * Deterministic length check — the "28-word hard reject" from the
 * word-count guardrail. No model call: counting words is a closed-set
 * check, exactly the kind of thing that shouldn't cost a network round
 * trip. Runs alongside the LLM factual audit and shares its correction
 * round-trip rather than needing a separate retry system.
 */
const MAX_BULLET_WORDS = 28;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function lengthFlags(text: string): string[] {
  const count = countWords(text);
  return count > MAX_BULLET_WORDS ? [`exceeds ${MAX_BULLET_WORDS}-word limit (${count} words)`] : [];
}

/**
 * Catches the specific low-signal bullet framings REPHRASE_SYSTEM_PROMPT
 * already tells the model to avoid — a deterministic backstop for when the
 * model ignores that instruction. This matters more than it might for other
 * prompt rules: rephraseSelectedBullets' pass-through fallback ships the
 * ORIGINAL bullet text verbatim whenever the model's response omits an id,
 * so an original bullet that already reads as "resolved 10 Jiras" ships
 * completely unrewritten and unaudited without this check. Pattern-based
 * and intentionally narrow — matches the 4 specific angles the rephrase
 * prompt bans, not a general "sounds low-signal" detector.
 */
const BANNED_ANGLE_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: "ticket/bug-count framing",
    regex: /\b(resolved|worked on|closed|fixed|delivered)\b[^.]{0,25}\b\d+[-–]?\d*\s*(jiras?|tickets?|bugs?)\b/i,
  },
  {
    label: "agile ceremony framing",
    regex: /\b(participated in|attended)\b[^.]{0,40}\b(standups?|stand-ups?|sprint planning|retrospectives?|daily scrum)\b/i,
  },
  {
    label: "passive codebase exploration",
    regex: /\b(investigated|studied|read)\b[^.]{0,40}\b(code|codebase)\b[^.]{0,20}\bto understand\b/i,
  },
  {
    label: "meta-prompt/rulebook description",
    regex: /\b(rulebook|prompt)\b[^.]{0,30}\b(encoding|encodes)\b[^.]{0,30}\b(anti-fabrication|boundaries)\b/i,
  },
];

export function bannedAngleFlags(text: string): string[] {
  return BANNED_ANGLE_PATTERNS.filter(({ regex }) => regex.test(text)).map(
    ({ label }) => `banned angle: ${label}`,
  );
}

/**
 * A bullet that spills a little onto a second rendered line, without
 * filling it, wastes vertical space and reads as unbalanced. CHARS_PER_LINE
 * is an ESTIMATE, not empirically measured — this environment has no LaTeX
 * renderer available (pdflatex/tectonic/xelatex are all absent), so this
 * value came from the user's own estimate of the real template's line
 * width, not from rendering it. Re-measure by rendering bullets of
 * 90/95/100/105 characters in the actual template and checking where the
 * line break lands, then adjust this constant if it's off.
 */
const CHARS_PER_LINE = 95;
const MIN_LINE2_FILL = 0.5;
const DENSITY_UPPER_BOUND = Math.ceil(CHARS_PER_LINE * (1 + MIN_LINE2_FILL));

export function bulletDensityFlags(text: string): string[] {
  const len = text.length;
  if (len > CHARS_PER_LINE && len < DENSITY_UPPER_BOUND) {
    return [
      `bad density: ${len} chars leaves line 2 mostly empty — tighten to <=${CHARS_PER_LINE} or expand to >=${DENSITY_UPPER_BOUND}`,
    ];
  }
  return [];
}

interface CategorizedFlag {
  category: "factual" | "length" | "density" | "banned-angle";
  message: string;
}

/** Combines every deterministic (non-LLM) check into one categorized list — the LLM factual audit is added separately by the caller, since only it needs a network call. */
function deterministicFlags(text: string): CategorizedFlag[] {
  const flags: CategorizedFlag[] = [];
  for (const message of lengthFlags(text)) flags.push({ category: "length", message });
  for (const message of bulletDensityFlags(text)) flags.push({ category: "density", message });
  for (const message of bannedAngleFlags(text)) flags.push({ category: "banned-angle", message });
  return flags;
}

/**
 * Strict LLM critic pass — catches hallucinations the fast deterministic
 * auditRewrite() can't (a paraphrased, unsupported responsibility claim like
 * "led the migration" has no distinctive regex shape to key on) — combined
 * with the deterministic word-count guardrail, since both funnel through
 * the same correct-then-reverify-then-fallback flow. Batches across all
 * bullets rather than calling per-bullet — up to 3 model calls total for
 * the whole batch, not 3 per bullet:
 *
 *   1. Audit every rewrite against its original; combine with a length
 *      check (>28 words) on the same text.
 *   2. For anything flagged (factual or length), request one corrected
 *      rewrite using only facts present in the original.
 *   3. Re-audit the corrections, re-checking length too. Anything still
 *      flagged — or where the correction pass produced nothing — falls
 *      back to the original bullet text verbatim: the only text guaranteed
 *      100% truthful (even if it doesn't hit the 18-26 word target).
 *
 * Never drops a bullet: every input rewrite gets exactly one VerifiedBullet.
 */
export async function verifyBullets(
  originalBullets: SelectedBullet[],
  rewrittenBullets: RewrittenBullet[],
  signal?: AbortSignal,
): Promise<VerifiedBullet[]> {
  const originalById = new Map(originalBullets.map((b) => [b.bulletId, b]));

  const knownRewrites = rewrittenBullets.filter((r) => originalById.has(r.bulletId));
  const factualFlags = await auditPass(
    knownRewrites.map((r) => ({ id: r.bulletId, original: r.originalText, rewritten: r.rewrittenText })),
    signal,
  );
  const firstPassFlags = new Map<string, CategorizedFlag[]>(
    knownRewrites.map((r) => [
      r.bulletId,
      [
        ...(factualFlags.get(r.bulletId) ?? []).map(
          (message): CategorizedFlag => ({ category: "factual", message }),
        ),
        ...deterministicFlags(r.rewrittenText),
      ],
    ]),
  );

  const needsCorrection = knownRewrites.filter((r) => (firstPassFlags.get(r.bulletId) ?? []).length > 0);
  const corrections = await correctionPass(
    needsCorrection.map((r) => ({
      id: r.bulletId,
      original: r.originalText,
      rewritten: r.rewrittenText,
      flaggedClaims: (firstPassFlags.get(r.bulletId) ?? []).map((f) => f.message),
    })),
    signal,
  );

  const correctedForReaudit = needsCorrection
    .filter((r) => corrections.has(r.bulletId))
    .map((r) => ({ id: r.bulletId, original: r.originalText, rewritten: corrections.get(r.bulletId)! }));
  const correctedFactualFlags = await auditPass(correctedForReaudit, signal);
  const secondPassFlags = new Map<string, CategorizedFlag[]>(
    correctedForReaudit.map((r) => [
      r.id,
      [
        ...(correctedFactualFlags.get(r.id) ?? []).map(
          (message): CategorizedFlag => ({ category: "factual", message }),
        ),
        ...deterministicFlags(r.rewritten),
      ],
    ]),
  );

  return rewrittenBullets.map((rewrite): VerifiedBullet => {
    const original = originalById.get(rewrite.bulletId);
    if (!original) {
      return {
        bulletId: rewrite.bulletId,
        experienceId: rewrite.experienceId,
        finalText: rewrite.originalText,
        verified: false,
        flaggedClaims: ["unknown bullet id — not present in the original selection"],
        usedFallback: true,
        unusable: false,
      };
    }

    const firstFlags = firstPassFlags.get(rewrite.bulletId) ?? [];
    if (firstFlags.length === 0) {
      return {
        bulletId: rewrite.bulletId,
        experienceId: rewrite.experienceId,
        finalText: rewrite.rewrittenText,
        verified: true,
        flaggedClaims: [],
        usedFallback: false,
        unusable: false,
      };
    }

    const correctedText = corrections.get(rewrite.bulletId);
    const remainingFlags = correctedText ? secondPassFlags.get(rewrite.bulletId) ?? [] : firstFlags;

    if (correctedText && remainingFlags.length === 0) {
      return {
        bulletId: rewrite.bulletId,
        experienceId: rewrite.experienceId,
        finalText: correctedText,
        verified: true,
        flaggedClaims: [],
        usedFallback: false,
        unusable: false,
      };
    }

    // Still flagged after correction (or the correction pass produced
    // nothing). Factual/length/density violations are always safe to
    // revert to the original bullet text — the original is truthful and
    // was never itself a length/density check target. A banned-angle
    // violation is different: the ORIGINAL text can be the violation (the
    // rephrase pass-through fallback ships original text verbatim, so
    // "resolved 10 Jiras" was already banned before any rewrite touched
    // it) — reverting there would ship exactly what this check exists to
    // catch. Mark it unusable instead; auditAndCompile drops it and
    // backfills from a spare rather than shipping finalText.
    const hasBannedAngle = remainingFlags.some((f) => f.category === "banned-angle");
    return {
      bulletId: rewrite.bulletId,
      experienceId: rewrite.experienceId,
      finalText: rewrite.originalText,
      verified: !hasBannedAngle,
      flaggedClaims: remainingFlags.map((f) => f.message),
      usedFallback: !hasBannedAngle,
      unusable: hasBannedAngle,
    };
  });
}

// ---------------------------------------------------------------------------
// LaTeX escaping — applied to every leaf value (bullet text, summary, stack
// items, skill items) before it goes into the template. Order matters:
// backslash must be escaped first, or the backslashes introduced by the
// other rules would themselves get escaped on a later pass.
// ---------------------------------------------------------------------------

const LATEX_ESCAPES: Array<[RegExp, string]> = [
  [/\\/g, "\\textbackslash{}"],
  [/%/g, "\\%"],
  [/&/g, "\\&"],
  [/#/g, "\\#"],
  [/\$/g, "\\$"],
  [/_/g, "\\_"],
];

export function escapeLatex(text: string): string {
  return LATEX_ESCAPES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

// ---------------------------------------------------------------------------
// Header content — summary, skills categories, per-role stack lines.
// Deterministic where possible (stack, skills); one LLM call for the
// summary, guarded by the same NUMBER_CLAIM_PATTERNS used above and backed
// by a deterministic fallback so a malformed/erroring call never blocks
// compilation.
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  languages: "Languages",
  frameworks_libraries: "Frameworks / Libraries",
  databases: "Databases",
  cloud_devops: "Cloud / DevOps",
  testing_tools: "Testing / Tools",
  practices: "Practices",
  ai_ml: "AI / ML",
};

function categoryRelevance(items: string[], jobSignals: JobSignals): number {
  const itemTokens = tokenize(...items);
  let score = 0;
  for (const tech of jobSignals.primary_tech) {
    if (hasAnyToken(tech, itemTokens)) score += 2;
  }
  for (const tech of jobSignals.secondary_tech) {
    if (hasAnyToken(tech, itemTokens)) score += 1;
  }
  return score;
}

/**
 * Builds the SKILLS section's inner LaTeX lines, reordered so categories
 * matching the JD's tech signals lead. Purely deterministic — profile.yaml
 * is the only source of the item lists, nothing here can add a skill.
 * Capped at `maxCategories` (default 5, matching the template's original
 * fixed count) to keep the section — and the resume — to roughly one page.
 */
export function buildSkillsCategories(
  profile: Profile,
  jobSignals: JobSignals,
  maxCategories = 5,
): string {
  const categories = Object.entries(profile.technical_skills)
    .filter(([, items]) => items.length > 0)
    .map(([key, items], index) => ({
      label: CATEGORY_LABELS[key] ?? key,
      items,
      relevance: categoryRelevance(items, jobSignals),
      index,
    }))
    .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
    .slice(0, maxCategories);

  return categories
    .map(({ label, items }, i) => {
      const line = `\\textbf{${escapeLatex(label)}}{: ${items.map(escapeLatex).join(", ")}}`;
      return i < categories.length - 1 ? `${line} \\\\` : line;
    })
    .join("\n");
}

/** A single word is tech-shaped if it has a digit (k6, 4o), tech punctuation (Node.js, C#), 2+ uppercase letters (NestJS, JSON), a lowercase-to-uppercase transition (reCAPTCHA), or simply starts uppercase (Redis, Docker) — the profile.yaml authoring convention this relies on is that real tool names are capitalized and bare concept words (concurrency, authorization, testing) are lowercase, which is orthographic, not resume-specific. */
function isSingleWordTechnical(word: string): boolean {
  if (/\d/.test(word)) return true;
  if (/[.#+/]/.test(word)) return true;
  if ((word.match(/[A-Z]/g) ?? []).length >= 2) return true;
  if (/[a-z][A-Z]/.test(word)) return true;
  if (/^[A-Z]/.test(word)) return true;
  return false;
}

/**
 * Distinguishes a technical proper noun (Redis, GraphQL, k6, Node.js, REST
 * API) from an operational/domain descriptor (guest access, bug fix, root
 * cause analysis) — generically, without hardcoding either resume's
 * vocabulary:
 *
 *   1. Exact match (case-insensitive) against `knownTech`, the flattened
 *      profile.yaml technical_skills list — the strongest, profile-sourced
 *      signal.
 *   2. Otherwise, shape (isSingleWordTechnical, above) — checked per word
 *      for multi-word tags, since a real multi-word protocol/tool name
 *      (REST API, Machine Learning) is every bit as valid as a single-word
 *      one. A tag is only kept if EVERY word in it is independently
 *      tech-shaped — one lowercase word (as in "guest access" or
 *      "third-party integration") marks the whole phrase as descriptive.
 *
 * Known gap: an all-lowercase single-word tool name not already in
 * technical_skills (e.g. an npm package styled in lowercase) reads as a
 * concept word and gets dropped. Fixing that generically needs a real tool
 * name database, not a heuristic — flagged rather than silently accepted.
 */
export function isTechnicalProperNoun(tag: string, knownTech: ReadonlySet<string>): boolean {
  const trimmed = tag.trim();
  if (knownTech.has(trimmed.toLowerCase())) return true;
  return trimmed.split(/\s+/).every(isSingleWordTechnical);
}

function flattenTechnicalSkills(profile: Profile): ReadonlySet<string> {
  return new Set(
    Object.values(profile.technical_skills)
      .flat()
      .map((item) => item.toLowerCase()),
  );
}

/** Union of tags across a role's chosen bullets, in bullet rank order, deduped, filtered to technical proper nouns only. Empty result (no bullets, or nothing tech-shaped) yields an empty string rather than fabricating a stack. */
export function buildStackLine(bullets: Array<{ tags: string[] }>, knownTech: ReadonlySet<string>): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const bullet of bullets) {
    for (const tag of bullet.tags) {
      if (!seen.has(tag) && isTechnicalProperNoun(tag, knownTech)) {
        seen.add(tag);
        ordered.push(tag);
      }
    }
  }
  return ordered.map(escapeLatex).join(", ");
}

const SUMMARY_SYSTEM_PROMPT = `You write a resume summary from a candidate's structured profile, tailored to a target job's language. These rules are universal — they apply to any candidate profile and any target job.

Hard constraint: NEVER include a number, percentage, dollar amount, or count of any kind — metrics belong in the bullets, not the summary. Never invent a skill, tool, employer, degree, or domain not present in the candidate's profile. Never name a specific employer/company — companies belong in the Experience section, not the summary. Never open with a job title from the profile — a job title reads as a narrow, single-role identity; the degree is the more durable identity claim.

Structure: exactly 3 sentences, ~45-55 words total:
- Sentence 1: [degree + institution + level, from the profile's education] — never a job title.
- Sentence 2: technical strengths tied to what the target job emphasizes (the JD's own primary_tech/core_responsibilities), grounded in the profile.
- Sentence 3: one high-impact statement on production delivery, scaling, or deployment — grounded in the profile's actual experience, not a generic claim.

At most 1-2 technologies named across the whole summary — never list frameworks back-to-back. Describe the kind of work instead ("full-stack web development", "backend systems", "GenAI applications") and let the Skills section carry the actual tool names.

Never use cliché filler, including but not limited to: "results-oriented", "proven track record", "passionate developer/engineer", "team player", "detail-oriented", "self-starter", "go-getter", "hard worker", "dynamic", "synergy", "comfortable debugging", "hands-on experience across". Plain, factual sentences only.

Call the record_summary tool exactly once with your result.`;

function buildSummaryUserPrompt(profile: Profile, jobSignals: JobSignals): string {
  const skillsLines = Object.entries(profile.technical_skills)
    .map(([key, items]) => `${CATEGORY_LABELS[key] ?? key}: ${items.join(", ")}`)
    .join("\n");
  const roles = profile.experiences
    .filter((e) => e.type === "work")
    .map((e) => `${e.role} at ${e.company} (${e.dates})`)
    .join("\n");
  const education = profile.education
    .map((e) => `${e.degree ?? "(degree unknown)"} — ${e.institution ?? "(institution unknown)"}${e.status ? ` (${e.status})` : ""}`)
    .join("\n");
  return [
    `Candidate education:`,
    education || "(none on file)",
    ``,
    `Candidate skills:`,
    skillsLines,
    ``,
    `Candidate work experience:`,
    roles,
    ``,
    `Target job signals:`,
    `Primary tech: ${jobSignals.primary_tech.join(", ") || "(none)"}`,
    `Secondary tech: ${jobSignals.secondary_tech.join(", ") || "(none)"}`,
    `Core responsibilities: ${jobSignals.core_responsibilities.join(", ") || "(none)"}`,
    `Domain keywords: ${jobSignals.domain_keywords.join(", ") || "(none)"}`,
  ].join("\n");
}

const SUMMARY_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
};

/**
 * Plain, fact-only, 3-sentence, well-under-55-word summary with zero model
 * involvement — the guaranteed-safe floor when the LLM call fails or
 * violates a hard constraint despite the prompt. Mirrors the same formula
 * the prompt is instructed to follow (degree first, never a job title; no
 * company names; no tech-stack enumeration) so a fallback never reads as a
 * different kind of summary than the LLM path — just a plainer one.
 */
function buildFallbackSummary(profile: Profile): string {
  const education = profile.education[0];
  const degreeLine =
    education?.degree && education?.institution
      ? `${education.degree} graduate from ${education.institution}`
      : "Software engineer with a strong technical foundation";
  return [
    `${degreeLine} with production software engineering experience.`,
    `Builds full-stack features across modern web and backend systems.`,
    `Ships production systems end to end, from design through deployment.`,
  ].join(" ");
}

const MAX_SUMMARY_WORDS = 55;

/** Cliché filler banned from the summary — plain, factual sentences only. Generic across any profile/JD, not tied to this candidate's wording. */
const SUMMARY_BUZZWORDS = [
  "results-oriented",
  "results oriented",
  "proven track record",
  "passionate developer",
  "passionate engineer",
  "team player",
  "detail-oriented",
  "detail oriented",
  "self-starter",
  "go-getter",
  "hard worker",
  "dynamic",
  "synergy",
  "comfortable debugging",
  "hands-on experience across",
];

function containsNumberClaim(text: string): boolean {
  return NUMBER_CLAIM_PATTERNS.some(({ regex }) => {
    regex.lastIndex = 0; // shared module-level regex objects — reset before each stateful .test()
    return regex.test(text);
  });
}

function containsBuzzword(text: string): boolean {
  const lower = text.toLowerCase();
  return SUMMARY_BUZZWORDS.some((phrase) => lower.includes(phrase));
}

/** Company names belong in Experience, not the summary — checked against profile.experiences' own company field, so this is never a hardcoded name and works for any candidate profile. */
function containsCompanyName(text: string, profile: Profile): boolean {
  const lower = text.toLowerCase();
  return profile.experiences.some((e) => e.company && lower.includes(e.company.toLowerCase()));
}

/**
 * The root cause of a summary opening with a job title wasn't just prompt
 * wording — the fallback path hit it too (it literally started with
 * `${latestRole}`), so both paths needed a deterministic check, not a
 * rewritten instruction alone. Checked against profile.experiences' own
 * role fields, so this is never a hardcoded title and works for any
 * candidate profile. Only checks the first sentence — a role title
 * mentioned later (e.g. describing a specific project) is fine.
 */
function startsWithJobTitle(text: string, profile: Profile): boolean {
  const firstSentence = (text.split(/(?<=[.!?])\s/)[0] ?? "").toLowerCase();
  return profile.experiences.some(
    (e) => e.type === "work" && e.role && firstSentence.includes(e.role.toLowerCase()),
  );
}

/** All hard constraints in one gate: no numbers, under the word cap, no cliché filler, no company name, no job-title opening. Any violation routes to the deterministic fallback rather than shipping a non-compliant summary. */
function violatesSummaryConstraints(text: string, profile: Profile): boolean {
  return (
    containsNumberClaim(text) ||
    countWords(text) > MAX_SUMMARY_WORDS ||
    containsBuzzword(text) ||
    containsCompanyName(text, profile) ||
    startsWithJobTitle(text, profile)
  );
}

export async function generateSummary(
  profile: Profile,
  jobSignals: JobSignals,
  signal?: AbortSignal,
): Promise<string> {
  let summary: string;
  try {
    const result = await callForJson<{ summary: string }>({
      system: SUMMARY_SYSTEM_PROMPT,
      user: buildSummaryUserPrompt(profile, jobSignals),
      toolName: "record_summary",
      toolDescription: "Records the tailored resume summary.",
      schema: SUMMARY_SCHEMA,
      signal,
    });
    summary = result.summary;
  } catch {
    return buildFallbackSummary(profile);
  }
  return violatesSummaryConstraints(summary, profile) ? buildFallbackSummary(profile) : summary;
}

// ---------------------------------------------------------------------------
// Template compilation — literal {{TOKEN}} substitution. Each token appears
// exactly once in templates/resume-template.tex, so a plain string replace
// per token is enough; no anchor/window heuristics needed once bullets are
// injected as one pre-formatted block per role instead of N fixed slots.
// ---------------------------------------------------------------------------

interface ExperienceGroup {
  /** Verified bullet text, ranked by original selection score (Wow-bullet-first). */
  texts: string[];
  /** Same bullets' tags, same order — feeds buildStackLine. */
  bullets: Array<{ tags: string[] }>;
  totalScore: number;
}

/**
 * Builds each experience's final bullet list from verifyBullets' output,
 * dropping anything marked `unusable` (a banned-angle violation that
 * correction couldn't fix — reverting to original isn't safe for those, see
 * VerifiedBullet.unusable) and backfilling the resulting gap from that
 * experience's spare bullets (selectRelevantBullets' SelectBulletsOptions.
 * spareCount) rather than shipping a role short a bullet or shipping the
 * violation. If there aren't enough usable spares to fully backfill, ships
 * fewer bullets than intended and warns — never fabricates a bullet.
 */
function buildExperienceGroups(
  verified: VerifiedBullet[],
  originalBullets: SelectedBullet[],
  warnings: string[],
): Map<string, ExperienceGroup> {
  const originalById = new Map(originalBullets.map((b) => [b.bulletId, b]));

  const byExperience = new Map<
    string,
    { primaries: Array<{ verified: VerifiedBullet; original: SelectedBullet }>; spares: Array<{ verified: VerifiedBullet; original: SelectedBullet }> }
  >();
  for (const v of verified) {
    const original = originalById.get(v.bulletId);
    if (!original || v.unusable) continue; // unusable bullets are dropped entirely — never shipped, never backfill material
    const bucket = byExperience.get(v.experienceId) ?? { primaries: [], spares: [] };
    (original.isSpare ? bucket.spares : bucket.primaries).push({ verified: v, original });
    byExperience.set(v.experienceId, bucket);
  }

  const groups = new Map<string, ExperienceGroup>();
  for (const [experienceId, { primaries, spares }] of byExperience) {
    primaries.sort((a, b) => b.original.score - a.original.score);
    spares.sort((a, b) => b.original.score - a.original.score);

    const targetCount = originalBullets.filter((b) => b.experienceId === experienceId && !b.isSpare).length;
    const deficit = Math.max(0, targetCount - primaries.length);
    const backfill = spares.slice(0, deficit);

    if (deficit > 0 && backfill.length < deficit) {
      warnings.push(
        `Role "${experienceId}" dropped ${deficit} unusable bullet(s) with only ${backfill.length} spare(s) available to backfill — shipped ${primaries.length + backfill.length} bullet(s) instead of ${targetCount}.`,
      );
    } else if (deficit > 0) {
      warnings.push(
        `Role "${experienceId}" backfilled ${backfill.length} bullet(s) from spares after dropping an unusable bullet.`,
      );
    }

    const final = [...primaries, ...backfill].sort((a, b) => b.original.score - a.original.score);
    groups.set(experienceId, {
      texts: final.map(({ verified: v }) => v.finalText),
      bullets: final.map(({ original }) => ({ tags: original.tags })),
      totalScore: final.reduce((sum, { original }) => sum + original.score, 0),
    });
  }
  return groups;
}

const CORE_ROLE_IDS = ["forty7", "njit_ra", "bnp_paribas"] as const;
type CoreRoleId = (typeof CORE_ROLE_IDS)[number];

/** Template has exactly one Projects block — whichever non-work experience scored highest overall fills it. Multi-project templates are future work. */
function pickBestProjectId(groups: Map<string, ExperienceGroup>): string | undefined {
  const excluded = new Set<string>(CORE_ROLE_IDS);
  let bestId: string | undefined;
  let bestScore = -Infinity;
  for (const [experienceId, group] of groups) {
    if (excluded.has(experienceId)) continue;
    if (group.totalScore > bestScore) {
      bestScore = group.totalScore;
      bestId = experienceId;
    }
  }
  return bestId;
}

function bulletsBlock(bullets: string[]): string {
  return bullets.map((bullet) => `  \\resumeItem{${bullet}}`).join("\n");
}

const MIN_BULLETS_PER_ROLE = 2;
const MAX_BULLETS_PER_ROLE = 3;

/**
 * Pre-compile validator #3: every experience entry gets 2-3 \resumeItem{}
 * lines. selectRelevantBullets already enforces this at selection time
 * (minPerRole/maxPerRole default 2/3), and neither rephraseSelectedBullets
 * nor verifyBullets can drop a bullet id after that — so under default
 * options this should never actually fire. It exists for callers who pass
 * non-default SelectBulletsOptions and land a role outside [2,3] as a
 * result. Can't safely auto-fix an under-count without fabricating a
 * bullet, so this warns rather than throws — a resume slightly out of spec
 * still ships, since blocking the whole run over it would be worse.
 */
export function checkBulletCount(experienceId: string, count: number, warnings: string[]): void {
  if (count < MIN_BULLETS_PER_ROLE || count > MAX_BULLETS_PER_ROLE) {
    warnings.push(
      `Role "${experienceId}" has ${count} bullet(s), outside the required ${MIN_BULLETS_PER_ROLE}-${MAX_BULLETS_PER_ROLE} range — check SelectBulletsOptions.`,
    );
  }
}

/**
 * Pre-compile validator #2: no slot/placeholder marker remains unreplaced.
 * A leftover {{TOKEN}} means compileTemplate's replacements map and the
 * template file have drifted apart — a code bug, not a data-quality issue —
 * so this throws rather than warns: shipping literal {{TOKEN}} text in a
 * resume is strictly worse than failing the run loudly.
 */
export function assertNoLeftoverPlaceholders(content: string): void {
  const leftover = content.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (leftover) {
    throw new Error(
      `Compiled resume still has unreplaced template placeholder(s): ${[...new Set(leftover)].join(", ")}`,
    );
  }
}

export interface TemplateSections {
  summary: string;
  skillsCategories: string;
  forty7: { stack: string; bullets: string[] };
  njit_ra: { stack: string; bullets: string[] };
  bnp_paribas: { stack: string; bullets: string[] };
  project: { name: string; date: string; stack: string; bullets: string[] };
}

/** Literal {{TOKEN}} -> value substitution. Every token is expected to appear exactly once; a token left in the output after this means the template and this map have drifted apart. */
export function compileTemplate(template: string, sections: TemplateSections): string {
  const replacements: Record<string, string> = {
    "{{SUMMARY}}": sections.summary,
    "{{SKILLS_CATEGORIES}}": sections.skillsCategories,
    "{{FORTY7_STACK}}": sections.forty7.stack,
    "{{FORTY7_BULLETS}}": bulletsBlock(sections.forty7.bullets),
    "{{NJIT_STACK}}": sections.njit_ra.stack,
    "{{NJIT_BULLETS}}": bulletsBlock(sections.njit_ra.bullets),
    "{{BNP_STACK}}": sections.bnp_paribas.stack,
    "{{BNP_BULLETS}}": bulletsBlock(sections.bnp_paribas.bullets),
    "{{PROJECT_NAME}}": sections.project.name,
    "{{PROJECT_DATE}}": sections.project.date,
    "{{PROJECT_STACK}}": sections.project.stack,
    "{{PROJECT_BULLETS}}": bulletsBlock(sections.project.bullets),
  };

  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(value);
  }
  return output;
}

/**
 * Step 4. Runs the strict LLM critic (verifyBullets) over every rewrite,
 * derives each role's stack line and the reordered skills block, generates
 * the summary, and compiles all of it into the LaTeX template. Needs
 * `profile` and `jobSignals` beyond what step 4 was originally scoped to —
 * summary/skills/stack generation genuinely needs the full profile and the
 * JD signals to reorder against, not just the selected/rewritten bullets.
 */
/**
 * Lint, not a hard block — surfaces the pattern where a role's shipped
 * bullets are all number-free, since some experiences (a fixed team size or
 * benchmark just doesn't exist for a given role) genuinely have no metric
 * to add. Purely informational: never reverts or drops a bullet.
 */
export function numberDensityCheck(experienceId: string, texts: string[], warnings: string[]): void {
  if (texts.length === 0) return;
  const hasAnyNumber = texts.some((text) => /\d/.test(text));
  if (!hasAnyNumber) {
    warnings.push(
      `Role "${experienceId}" shipped ${texts.length} bullet(s) with no numbers/metrics at all — consider adding a number-bearing fact from profile.yaml if one exists for this role.`,
    );
  }
}

export async function auditAndCompile(
  rewrittenBullets: RewrittenBullet[],
  originalBullets: SelectedBullet[],
  profile: Profile,
  jobSignals: JobSignals,
  templatePath: string,
  signal?: AbortSignal,
): Promise<CompiledResume> {
  const verified = await verifyBullets(originalBullets, rewrittenBullets, signal);

  const warnings: string[] = [];
  const flaggedBulletIds: string[] = [];

  for (const v of verified) {
    if (v.unusable) {
      flaggedBulletIds.push(v.bulletId);
      warnings.push(
        `Banned-angle violation(s) not resolvable by correction — dropped bullet ${v.bulletId}: ${v.flaggedClaims.join(", ")}.`,
      );
    } else if (v.usedFallback) {
      flaggedBulletIds.push(v.bulletId);
      const reason =
        v.flaggedClaims.length > 0
          ? `New claim(s) not traceable to original bullet: ${v.flaggedClaims.join(", ")}`
          : `Rewrite for unknown bullet id "${v.bulletId}"`;
      warnings.push(`${reason} — reverted bullet ${v.bulletId} to original text.`);
    }
  }

  const groups = buildExperienceGroups(verified, originalBullets, warnings);
  const knownTech = flattenTechnicalSkills(profile);

  const roleSection = (id: CoreRoleId): { stack: string; bullets: string[] } => {
    const group = groups.get(id);
    const texts = group?.texts ?? [];
    checkBulletCount(id, texts.length, warnings);
    numberDensityCheck(id, texts, warnings);
    return {
      stack: buildStackLine(group?.bullets ?? [], knownTech),
      bullets: texts.map(escapeLatex),
    };
  };

  const bestProjectId = pickBestProjectId(groups);
  const projectExperience = bestProjectId
    ? profile.experiences.find((e) => e.id === bestProjectId)
    : undefined;
  const projectGroup = bestProjectId ? groups.get(bestProjectId) : undefined;
  const projectTexts = projectGroup?.texts ?? [];
  const projectSection = projectExperience
    ? {
        name: escapeLatex(projectExperience.role),
        date: escapeLatex(projectExperience.dates),
        stack: buildStackLine(projectGroup?.bullets ?? [], knownTech),
        bullets: projectTexts.map(escapeLatex),
      }
    : { name: "", date: "", stack: "", bullets: [] };

  if (!projectExperience) {
    warnings.push("No project scored above the work roles — Projects section left empty.");
  } else {
    checkBulletCount(bestProjectId!, projectTexts.length, warnings);
    numberDensityCheck(bestProjectId!, projectTexts, warnings);
  }

  const summary = escapeLatex(await generateSummary(profile, jobSignals, signal));
  const skillsCategories = buildSkillsCategories(profile, jobSignals);

  const template = await fs.readFile(templatePath, "utf8");
  const content = compileTemplate(template, {
    summary,
    skillsCategories,
    forty7: roleSection("forty7"),
    njit_ra: roleSection("njit_ra"),
    bnp_paribas: roleSection("bnp_paribas"),
    project: projectSection,
  });
  assertNoLeftoverPlaceholders(content);

  return { content, warnings, flaggedBulletIds };
}

// ---------------------------------------------------------------------------
// Orchestrator — chains all four steps for callers that just want the result
// ---------------------------------------------------------------------------

export async function runTailoringPipeline(params: {
  jobDescriptionText: string;
  profileYamlPath: string;
  templatePath: string;
  selectOptions?: SelectBulletsOptions;
  signal?: AbortSignal;
}): Promise<{ jobSignals: JobSignals; selected: SelectedBullet[]; compiled: CompiledResume }> {
  const jobSignals = await extractJobSignals(params.jobDescriptionText, params.signal);
  const profile = await loadProfile(params.profileYamlPath);
  const selected = await selectRelevantBullets(jobSignals, profile, params.selectOptions);
  const rewritten = await rephraseSelectedBullets(selected, jobSignals, params.signal);
  const compiled = await auditAndCompile(
    rewritten,
    selected,
    profile,
    jobSignals,
    params.templatePath,
    params.signal,
  );
  return { jobSignals, selected, compiled };
}
