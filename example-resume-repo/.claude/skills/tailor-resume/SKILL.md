---
name: tailor-resume
description: Tailor resume.md to a specific job posting without fabricating anything — outputs a short fit-report.md and a ready-to-compile tailored-resume.tex. Read this before making any changes when asked to tailor the resume in this repository.
---

# Tailor resume for one job

You are tailoring the master resume in this repository (`resume.md`) to a
specific job posting supplied in the prompt. Follow every rule in this file.

## Source of truth

- Read `resume.md` in the repo root completely before writing anything. It is
  the single source of truth about the candidate.
- Hierarchy when facts conflict: `resume.md` > verified JD facts > stylistic
  suggestions.
- Inline notes in `resume.md` (e.g. "frame as...", "do not phrase as...", "not
  as tests she ran") are binding wording constraints, not background color —
  equal in priority to the hard boundaries below. Apply the framing exactly
  as written; no bullet or summary sentence may imply beyond what the note
  allows.
- JD requirements not supported by `resume.md` are silently excluded from the
  resume — never fabricated, and never written out in detail (see Output
  convention below on keeping the fit report short).
- A human reviews the PR before applying — this skill never auto-submits an
  application.

## Workflow

Only two files are ever written. Everything else below (JD classification,
risk map, bullet drafting, keyword mapping) is internal reasoning — do not
externalize it into extra files or a long fit report. This keeps runs fast
and cheap.

1. **Ingest** — Read the per-run prompt (company, role, URL, job description).
   Internally classify each JD line into one of: Must-have, Preferred,
   Responsibilities, Tools/stack, Nice-to-have. Must-have and
   Responsibilities map to Strong-match reasoning when evidenced; Preferred
   and Nice-to-have map to Gap reasoning when missing; Tools/stack maps to
   skills alignment.
2. **Fit report** — Load `references/fit-report.md`. Decide the tier
   internally, then write the **short** `jobs/{company-slug}/{role-slug}/fit-report.md`
   per the compact format in that reference — tier, verdict, 1-2 sentence
   reason. No Strong matches / Gaps / Do not add tables.
3. **Tailor (internal)** — Load `references/format-and-recruiter-rules.md`
   (ATS formatting, resume structure, bullet counts, stack-line rules,
   recruiter heuristics — all in one file). Build the recruiter-side risk map
   internally, then compose the tailored resume content (summary, skills,
   stack lines, bullets) in memory by rephrasing/reordering/emphasizing facts
   from `resume.md` only — do not write this to a separate markdown file.
   Respect the fixed bullet counts in that reference (Forty7: 3, NJIT RA: 3,
   BNP: 3, each project: 3).
   - Keyword alignment & Domain Translation: Mirror JD phrasing when factually 
     equivalent to `resume.md`. Translate raw implementation details into plain, 
     high-level engineering concepts matching the JD's problem domain (e.g., 
     reframing API fetching as "multi-source data-ingestion pipeline" if relevant 
     to the JD). Never keyword-stuff. Expand an acronym once if the JD uses 
     the long form and the resume has the skill. If the JD asks for a skill 
     absent from `resume.md`, it stays absent from the tailored resume — never 
     adopted just because the JD named it.
4. **LaTeX output** — Read `templates/resume-template.tex` (this path is
   relative to the **repo root** — a top-level `templates/` folder, NOT
   nested under `.claude/skills/tailor-resume/`) and write
   `jobs/{company-slug}/{role-slug}/tailored-resume.tex`: fill the template's
   placeholder slots (summary, skills lines, stack lines, bullets, project
   block) with the composed content from step 3. Rules:
   - Escape LaTeX special characters: `%` → `\%`, `&` → `\&`, `#` → `\#`,
     `$` → `\$`, `_` → `\_`.
   - Date ranges use `--` (e.g. `Jan 2026 -- May 2026`).
   - **Project links are conditional on `resume.md` actually having one.**
     The template's project-heading slot is `{\textbf{NAME} $|$
     \href{URL}{Link}}{DATE}`, but not every project in `resume.md` has a
     `Repo:` field (e.g. private/unpushed work). When there's no real URL for
     that project, omit the `$|$ \href{...}{Link}` portion entirely — write
     `{\textbf{NAME}}{DATE}` instead. Never fall back to a generic profile
     URL (e.g. the bare GitHub profile) just to fill the slot — a link that
     doesn't point at the actual project is worse than no link.
   - Do not alter the template's preamble, custom commands, or spacing —
     content goes into the marked slots only.
   - Keep heading structure: company bold via `\resumeExpHeading`, stack via
     `\resumeStack`, bullets via `\resumeItem`.
   - **`SLOT-TITLE-PREFIX`** appears twice (Forty7 and BNP only), each
     followed by `Intern`. NJIT's heading is fixed as plain `Research
     Assistant` — never dynamic, never prefixed, regardless of the JD's own
     title wording.
     Fill the slot once with a single value, reused both places, derived from
     this JD's own title wording — e.g. JD titled "Software Engineer" →
     `Software Engineer`; "Full-Stack Software Engineer (Product)" →
     `Full-Stack Software Engineer`. If the JD's title is too
     company-specific to reuse honestly (e.g. "Internal Applications
     Engineer" — Forty7/BNP work doesn't support that framing), fall
     back to the generic `Software Engineer`. Never carry a seniority word
     from the JD title (Senior, Staff, Lead, Principal) — `resume.md` doesn't
     support that level.
5. **Quality** — Before writing the `.tex`, self-check the composed content
   against the Hard boundaries section below and the six-second clarity gate
   + ASCII normalization rules in `references/format-and-recruiter-rules.md`.
   Fix violations in memory, then write the file once.

## Output location convention

Write exactly two files, creating directories as needed:

```
jobs/{company-slug}/{role-slug}/fit-report.md
jobs/{company-slug}/{role-slug}/tailored-resume.tex
```

Slugs are lowercase, non-alphanumeric runs replaced with single hyphens; strip
legal suffixes (Inc, LLC, Ltd) from company names
(e.g. "Acme Corp Inc." → `acme-corp`, "Senior Software Engineer" → `senior-software-engineer`).

Never modify `resume.md` itself or delete anything outside your output folder.
Never write `tailored-resume.md` or `change-summary.md` — those are retired.

## Bullet style — STAR method, always

Every bullet in the composed resume content (and the final `tailored-resume.tex`)
follows STAR compressed to one line:
**outcome/result first, then the action and context that produced it.**

- Pattern: `<Result or problem solved> by <action> <context/stack>` — e.g.
  "Prevented duplicate-signup failures by handling failed API responses and
  re-routing existing profiles to the subscribe flow in NestJS."
- Never write plain "Built X using Y" activity bullets. If the master profile
  phrases something that way, reframe it around the problem it solved or the
  outcome it enabled.
- **Every bullet must contain at least one concrete number** (metric, scale,
  count, duration, accuracy) taken from `resume.md` — 90%, 3,000+, 15 lots,
  100 users, 500K documents, 12-person team, 10+ endpoints, under 3 minutes.
  This is a hard requirement, not a preference:
  - When choosing between candidate facts for a bullet slot, the fact with a
    number wins.
  - Before finishing each role, audit its bullets: at most ONE bullet per
    role may lack a number, and only when `resume.md` genuinely has no number
    for any phrasing of that fact.
  - ONLY numbers that exist in `resume.md`. Never invent or extrapolate.
- When no metric exists after that audit, the result clause is qualitative
  but concrete (what became possible, what failure stopped happening).

## Audience rule — ATS first, recruiter second, engineer last

The resume has two gatekeepers before any engineer reads it: the ATS keyword
scan, then a recruiter skimming for ~7 seconds. Write for them.

- **Hard cap: 25 words per bullet.** Count the words; 26+ is a violation —
  rewrite until it fits. One idea per bullet. No chained arrows (`A → B → C`),
  no multi-clause pile-ups.
- **F-scan rule: the first 3-4 words of every bullet must carry the outcome.**
  Recruiters scan the left edge of the page; a bullet earns its read in its
  opening words ("Cut release cycles to 3 minutes...", "Reached 90% pricing
  accuracy..."). Never open with process framing.
- **No enumeration bullets.** "Shipped X end to end: schema, mutation, queue
  logic" lists the process, not the result — banned. State what the feature
  achieved or enabled; the components stay in the master profile for
  interviews.
- **No parenthetical tech-stack dumps in bullets.** Stack lives on the
  `*Stack:*` line under each role heading (see
  `references/format-and-recruiter-rules.md`); a bullet names at most 1-2
  technologies, woven into the sentence.
- **Don't re-list the stack line inside bullets.** If the stack line already
  says NestJS, GraphQL, TypeORM, Bull queue, a bullet that recites three of
  them ("by building a NestJS GraphQL API, TypeORM entity, and Bull queue
  job") is redundant noise. Name a technology in a bullet only when that
  specific pairing adds information the stack line can't carry.
- **No low-signal keywords.** Never surface junior/weak-signal work in a
  bullet: "CSS fixes", "styling tweaks", "attended standups", "updated
  documentation". These exist in the master profile for completeness, not for
  the resume. Exception: the JD itself emphasizes that exact skill.
- **One fact, one bullet.** A metric or fact from `resume.md` (e.g. "10-12
  Jiras") may appear in at most ONE bullet per resume. Duplicating a fact
  wastes a slot.
- **Bullet order within each role: Wow → Bridge → ATS.**
  1. *Wow* — the most impressive, metric-backed thing done there. The single
     bullet you'd keep if only one survived.
  2. *Bridge* — the fact that most directly maps this role's work onto the
     JD's requirements, phrased in the JD's language.
  3. *ATS* — the keyword carrier: JD-matching tools, duties, and practices
     woven into one honest bullet.
  The JD decides which fact is Wow vs Bridge — for an AI-heavy JD the GenAI
  tool leads; for a platform JD the production feature might.
- **Self-check before writing files:** re-read every bullet against the
  banned lists (weak starts, clichés, banned verbs, low-signal keywords) and
  the rules above. Fix violations, then write.
- **JD keywords must appear in plain sight** — name the technology the way
  the JD names it (e.g. "CI/CD pipeline", "REST APIs", "PostgreSQL"), because
  that is what the ATS matches on.
- **No implementation internals** — this covers both literal code syntax
  AND conceptual implementation-pattern jargon a recruiter has never heard
  of, even when it isn't literally a function/file/class name:
  - Never include function names, file names, class names, config values,
    shell commands, code syntax, or backticked identifiers. "Automated
    deployment with a CI/CD pipeline (GitHub Actions, AWS EC2)" — not the
    build → SCP → systemd chain.
  - Never name a queueing/job-runner mechanism (e.g. "Bull queue job",
    "cron job", "worker process") — say "background job" or "automated job."
  - Never name an ORM/framework-internal concept (e.g. "TypeORM entity",
    "Django model", "Mongoose schema") — say "database record" or "database
    schema."
  - Never name a GraphQL/API-internal term (e.g. "GraphQL mutation",
    "resolver", "middleware") — say "write operation" or "API endpoint."
  - Never cite an HTTP status code (e.g. "409 API response", "404 error") —
    describe the situation instead: "a duplicate-request error."
  - Test: only recognizable technology *brand names* (NestJS, GraphQL,
    PostgreSQL, AWS, React) are allowed as nouns — the pattern or mechanism
    behind them is described in plain words, never named.
- **Plain-English verbs a non-engineer understands**: built, launched,
  automated, reduced, sped up, secured, scaled. The recruiter must grasp what
  happened without knowing what systemd or a Bull queue is.
- **Simple verbs, technical nouns.** Verbs carry zero ATS keyword value, so
  keep them plain — never "orchestrated", "leveraged", "spearheaded",
  "architected", "utilized", "facilitated". The technical precision lives in
  the nouns, which are exactly what the ATS matches: "GraphQL API",
  "PostgreSQL", "RAG pipeline", "CI/CD". A recruiter must follow the sentence;
  an engineer must respect the nouns. Both, always.
- **A project's first bullet must say what the product does for its user**
  before any bullet goes deep on tech — "Built an AI styling app that
  suggests outfits from photos of the user's own wardrobe, powered by OpenAI
  vision models and vector search." If the reader can't tell what the project
  is, the technical bullets after it are wasted.
- Depth lives in the master profile and comes out in interviews — the bullet
  only has to earn the phone screen.

## Tailoring approach

- **Reorder and emphasize, don't invent.** Move the most relevant experience
  and bullets to the top. Trim bullets that are irrelevant to this posting.
- **Project selection.** `resume.md` lists multiple projects, each with a
  "Context for tailoring" note describing what kind of JD it's strong
  evidence for. Rank every project against this JD using those notes before
  composing.
  - **Default to two projects, not one.** Pick the two most relevant + most 
    recent projects and give each 2 bullets.
  - Drop to exactly one project (3 bullets) only when a second project would
    be a genuine stretch.
- **Summary rewrite.** Rewrite the summary section to speak to this role,
  using only facts from `resume.md`. Rules:
  - Exactly 3 sentences, ~45-55 words total.
  - No numbers or metrics — accuracy percentages, user counts, item counts
    all live in bullets, never in the summary.
  - **No tech-stack enumeration.** Sentence 1 may name at most 1-2
    technologies total across the whole summary (or zero) — never list
    frameworks back-to-back ("Java, Python, TypeScript, Spring Boot, NestJS,
    React, Angular"). Describe the *kind* of work instead ("full-stack web
    development", "backend systems", "GenAI applications") and let the
    Skills section carry the actual tool names.
  - **Match tone to seniority level in the JD.** For roles explicitly framed
    as junior/mentored ("under the guidance of", "entry-level", "apply
    feedback from senior engineers"), lean the summary toward eagerness to
    learn and collaboration — not pure self-sufficiency. For senior/ownership
    JDs, lean toward independence and end-to-end ownership. Never claim a
    seniority posture the JD doesn't ask for.
  - Degree status must match `resume.md` exactly — if it says completed,
    never write "completing", "pursuing", or "expected".
  - Apply the banned weak-starts and banned-clichés lists from
    `references/format-and-recruiter-rules.md`. No trait-adjective openers
    ("thrives on", "passionate about", "proven track record"). Plain,
    factual sentences only.
- **Length.** Keep the tailored resume to roughly one page of markdown.

## Hard boundaries — never violate these

- Never mention visa status, sponsorship, H-1B, work authorization, or
  immigration anywhere in the generated resume.
- Never add a skill, tool, language, or framework that is not in `resume.md`.
- Never add an employer, title, project, or date range not in `resume.md`.
- Never add or change a metric (percentages, dollar amounts, team sizes,
  multipliers). Metrics may only be copied verbatim from `resume.md`.
- Never inflate seniority ("led" stays "led" only if `resume.md` says so).
- Never claim certifications, degrees, or publications not in `resume.md`.
- Never hide keywords in white text, metadata, or any invisible layer.
- Never paste JD paragraphs into the resume body.
- Never add a metric that can't be traced verbatim to `resume.md`.
- Never carry a skill forward from `resume.md`'s Skills section into the
  tailored resume without checking it's backed by at least one bullet, stack
  line, or project elsewhere in `resume.md`.
- If the job is a poor fit, say so in `fit-report.md` with the Stretch tier —
  do not force a match.