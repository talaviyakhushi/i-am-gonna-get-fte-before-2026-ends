# Format and recruiter rules

Combined reference for the Tailor step: ATS formatting, resume structure,
bullet counts, stack-line rules, and recruiter-side heuristics. Load this
once and apply all sections below.

## ATS formatting and parsing

- Single column; standard headings: **Summary**, **Work Experience**, **Skills**, **Education**.
- No tables, text boxes, icons, or multi-column layouts.
- Bullets: one accomplishment per line; start with strong verbs.
- Plain-text test: paste output into Notepad—order and headings must remain readable.
- Greenhouse/Lever parsers favor standard section titles and plain bullets.
- Dates as `Mon YYYY - Mon YYYY` ranges (e.g. `Jan 2026 - May 2026`), copied
  from the master profile — never collapse a range to a bare year; tenure
  length must be visible.
- No images, HTML layout, columns, or emoji in the resume body.
- No code identifiers, file names, port numbers, or backticked tokens in
  bullets — ATS parsers and recruiters both choke on them.
- PDF export is user-driven, not part of this workflow.

## Markdown resume structure

1. Name + contact line
2. Summary (3–4 lines max for tailored version)
3. Work Experience (reverse chronological)
4. Skills (grouped if helpful)
5. Education

### Bullet counts — fixed, not optional

- **Forty7 (most recent role): exactly 3 bullets**
- **NJIT Research Assistant: exactly 3 bullets**
- **BNP Paribas: exactly 3 bullets**
- **Each project included: exactly 3 bullets**

Pick the strongest bullets for the specific JD — counts are the budget, JD
relevance decides what fills it. Do not pad with weak bullets to hit a count;
if evidence is thin, choose the closest honest match from the master profile's
bullet variants instead.

Job block template:

```markdown
### Title - Company (dates)
*Stack: Tool1, Tool2, Tool3, Tool4*

- Bullet in one-line STAR form: result/outcome first, then action + context,
  with metric when the master profile has one
```

Use HTML comments `<!-- anchor:company-role -->` only when needed for stable diffs.

### Tech stack placement

- Every job and project gets a one-line `*Stack: ...*` italic line directly
  under its heading with **at most 4 items** — the technologies most relevant
  to this JD, picked from the master profile. Not an inventory: the 4 that
  make the recruiter nod. Everything else stays in the master profile and the
  Skills section.
- Bullets mention at most 1-2 technologies each, woven into the sentence
  naturally ("a role-guarded GraphQL mutation", "a Spring Boot service").
- **Never** dump a parenthetical stack list inside a bullet —
  "(Angular, Spring Boot, Java, MySQL, AWS EC2/Amplify)" is banned. The stack
  line carries that information; the bullet carries the outcome.

### Skills section — max 5 categories

- The tailored resume's Skills section has **at most 5 categories**, 4-8 items
  each. The master profile's full skill list is the source; the JD decides
  which categories exist and what fills them.
- Choose category names by role archetype, not by copying the master's
  grouping. Backend JD → Languages, Backend, Databases, Cloud/DevOps,
  Practices. AI-heavy JD → swap a category for AI/ML. Frontend JD → swap in
  Frontend.
- Categories must be semantically correct: Agile/Scrum and API design are
  practices, never tools; JUnit is a testing framework; REST APIs is not a
  tool. If an item doesn't fit a category honestly, cut the item rather than
  bend the category.
- Order categories by JD relevance — the stack the JD names most goes first
  after Languages.
- Drop weak/irrelevant items entirely (e.g. Figma on a backend application).
  A shorter, sharper skills block beats an exhaustive one.
- **Exception: don't drop a term the JD itself explicitly lists as a
  qualification, just because it reads as generic or unimpressive** — DSA,
  OOP, SDLC, debugging, version control, "CS fundamentals," and similar.
  This rule exists to keep the Skills block impressive to a *human* reader;
  it isn't license to silently fail an ATS keyword match on something the
  JD literally asked for and `resume.md` genuinely backs. If it's true and
  the JD named it, it goes in — in whichever category name fits honestly
  (e.g. a `Concepts` category for OOP/DSA, separate from `Practices` for
  Agile/Scrum/testing — see the category-naming rule above). Bullets stay
  reserved for outcomes regardless; this coverage lives in Skills, not in a
  bullet slot.

### Stack-line / bullet coherence

- **Strict Explicit Evidence:** Every single tool listed on a role's or project's `*Stack:*` line must be explicitly named as an exact ATS keyword in at least one bullet for that role. Do not rely on implicit usage or assuming a tool is "obviously behind" the work. If a tool cannot be explicitly named in a bullet without crowding it, drop that tool from the `*Stack:*` line.
- When a bullet describes work a stack-line tool performed, use the full explicit keyword: "JUnit unit and integration tests", not "unit and integration test coverage"; "GitHub Actions pipeline", not "automated pipeline". Generic phrasing wastes an exact-match keyword the stack line committed to.
- After writing each role, execute an explicit validation check: iterate through every item on the `*Stack:*` line one by one and point to the exact bullet text that names it. Remove any unevidenced tools immediately.

## Recruiter-side heuristics

Rules for maximizing ATS pass rate and recruiter approval. (Adapted from
career-ops recruiter-side heuristics.)

### Recruiter-side risk map (internal, never printed)

Before writing bullets, map the doubts a recruiter will have and pick content
that closes each one:

| Potential doubt | Evidence to surface | Fix in the resume |
|-----------------|---------------------|-------------------|
| Can they do this stack? | Matching tools, systems, projects | Put the exact JD stack keywords in truthful context |
| Are they senior enough? | Ownership, scope, sole-developer work, tradeoffs | Lead with ownership behaviors, not tenure |
| Is the domain relevant? | Similar users, workflows, scale | Translate adjacent experience into the JD's language |
| Is the application generic? | Weak or broad bullets | Rewrite around this role's concrete problems |

Never invent evidence to close a doubt — an unclosable doubt goes in the fit
report's Gaps reasoning only, never the resume.

### Six-second clarity gate

The top third of the resume (summary + first experience bullets) must make fit
impossible to miss. A recruiter reading only that must see:

- target role/archetype matching the JD title
- strongest matching stack or domain
- one production or business outcome (with a real metric when one exists)

**Be literal about "matching the JD title":** the summary's opening noun
phrase should echo the JD's own title language, not a synonym you picked
yourself. JD titled "Software Engineer" → open with "Software engineer who
...", not "Full-stack engineer who ..." — even when "full-stack" is true and
relevant, it doesn't belong in the opening two words if the JD didn't use
that word for the role. Work the more specific/accurate descriptor in later
in the same sentence instead of swapping it in as the headline noun.

If fit must be inferred from scattered bullets lower down, rewrite the summary
and the first bullets until it doesn't.

### Business-value bullet patterns

Prefer: `Action + system/scope + tool + outcome + proof`

- `Resolved [problem] in [system], improving [business/system effect].`
- `Built [capability] with [tools], enabling [user/team outcome].`
- `Migrated [old] to [new], reducing [risk/cost/latency/debt].`
- `Improved [metric] from [before] to [after] by [technical action].`

**Banned weak starts** (when stronger ownership is true): "helped", "assisted",
"responsible for", "worked on", "participated in", "contributed to".

**Banned clichés — never generate these in any output:**

- "passionate about …"
- "results-oriented professional" / "proven track record"
- "leveraged cutting-edge …"
- "spearheaded a strategic initiative"
- "cross-functional synergies"
- "robust, scalable solutions"
- "in today's fast-paced …"
- "demonstrated ability to drive innovative outcomes"

### ATS reality check

Optimize for parseability and honest keyword match, not tricks:

- exact JD keywords, only in truthful context
- no keyword stuffing, hidden text, or white-font tricks
- no skills or metrics not present in `resume.md`

### ASCII normalization — required

ATS parsers choke on typographic Unicode. In `tailored-resume.tex` use only
ASCII punctuation:

| Never use | Use instead |
|-----------|-------------|
| em-dash `—` (U+2014) | hyphen `-` |
| en-dash `–` (U+2013) | hyphen `-` (e.g. `2020-2024`, `Jan 2024 - Jul 2024`) |
| curly quotes `" " ' '` | straight `"` and `'` |
| ellipsis `…` | `...` |
| non-breaking / zero-width spaces | regular space |

This applies to `tailored-resume.tex` — the fit report may use normal
typography.