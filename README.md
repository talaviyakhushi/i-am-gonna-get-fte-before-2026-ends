# resume-tailor-agent

Personal job-search toolkit:

- **Resume tailor.** A Chrome extension captures a job posting. A local API
  tailors your resume to it with Claude and saves a LaTeX file.
- **Job scanner.** Pulls new grad postings from company job boards
  (Greenhouse, Lever, Ashby) and emails a daily digest.

```
Chrome extension ──► local API (Express) ──► tailoring pipeline (Claude Messages API)
(capture posting)    (orchestrator, SSE)     └► tailored-resumes/{date}/{company}/{role}/tailored-resume.tex
                                             └► tailored-resumes/applications-tracker.csv
```

## Layout

| Path | What |
|---|---|
| `packages/shared` | Shared types, `validateJobPayload`, `slugify` |
| `apps/api` | Local Express server: `/runs` orchestration, SSE progress, tailoring pipeline |
| `apps/extension` | Chrome MV3 extension: capture posting, confirm, live progress |
| `example-resume-repo` | Resume source: `profile.yaml` (all experience bullets) and `templates/resume-template.tex`. Separate git repo, ignored here. |
| `job-scanner` | Daily new grad job scan, filters, and filter evals |
| `tailored-resumes` | Output: one folder per tailored resume, plus the applications tracker |
| `docs/TESTING.md` | Setup, smoke tests, and manual E2E runbook |

## Quick start

```sh
pnpm install
pnpm --filter @resume-tailor/shared build   # API and extension import the built package
pnpm typecheck && pnpm test

# API
cd apps/api && cp .env.example .env   # fill in keys — see docs/TESTING.md
pnpm dev:api

# Extension
pnpm --filter @resume-tailor/extension dev
# chrome://extensions → Load unpacked → apps/extension/dist
```

## How a tailoring run works

1. `POST /runs` validates the confirmed job payload, rejects a second run while
   one is active (409), and returns `202 {runId}`.
2. **Early exits:**
   - Postings that rule out visa sponsorship → status `blocked`.
   - Postings whose JSON-LD `datePosted` is more than 14 days old → status
     `stale`. The popup can retry with `force: true`.
3. The pipeline in `apps/api/src/services/tailoring-pipeline.ts`:
   1. **Extract signals.** Claude pulls primary/secondary tech and other
      signals from the job description.
   2. **Select bullets.** Scores every bullet in `profile.yaml` against those
      signals and picks 2–3 per role, plus spares (no model call).
   3. **Rephrase.** Claude rewrites the picked bullets toward the job's
      wording. It must not add new facts.
   4. **Audit and compile:**
      - Claude fact-checks each rewrite against its original.
      - Code checks length, line fill, and banned topics.
      - Failing bullets are corrected or reverted to the original. Unusable
        ones are dropped and replaced from spares, never invented.
      - Then the summary, skills, and stack lines are built and filled into
        the LaTeX template.
4. The `.tex` file is saved under `tailored-resumes/` and a row is appended to
   `applications-tracker.csv`. Warnings (reverted bullets, missing metrics,
   short roles) come back in the run result.
5. The popup streams progress from `GET /runs/:id/events` (SSE). Output files
   can be downloaded from `GET /runs/:id/files/<path>`.

Model calls use structured tool output (`tool_choice`), not free-text JSON.
The pipeline is built for one resume layout: three work roles and one project
(`CORE_ROLE_IDS` and the template placeholders).

## Job scanner

```sh
pnpm scan-jobs                                # scan, write results + seen.json, email digest
npx tsx job-scanner/scan.ts --dry-run         # print only, no writes, no email
npx tsx job-scanner/scan.ts --no-email        # write results, skip email
```

- Companies come from `job-scanner/companies.json`.
- Filters in `job-scanner/filters.ts`:
  - Software role with a new grad/entry-level signal.
  - US location.
  - Posted within 60 days.
  - Description doesn't ask for 3+ years.
- New matches go to `job-scanner/results/{date}.md`. `seen.json` prevents
  repeats.
- Email needs `job-scanner/.env` (copy `.env.example`; uses a Gmail app
  password).

Filter evals: `npx tsx job-scanner/evals/run_eval.ts` scores the title and
location filters against hand-labeled postings in `evals/filter_labels.jsonl`.
Add real mistakes there when you find them.

## Security notes

- All secrets live in `apps/api/.env` and `job-scanner/.env` (gitignored).
  They are never bundled into the extension.
- `/runs` requires the `X-Resume-Agent-Token` shared secret, compared in
  constant time. CORS is restricted to `API_ORIGIN_ALLOWLIST`.
- Error messages are sanitized (API key, auth token, tmp paths stripped)
  before storage.
