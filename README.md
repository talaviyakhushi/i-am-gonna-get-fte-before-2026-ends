# resume-tailor-agent

Personal tool that tailors your markdown resume to a job posting using the
Claude Agent SDK, then opens a PR on your resume repo.

```
Chrome extension ──► local API (Express) ──► Claude Agent SDK edits a cloned
(capture posting)    (orchestrator)          copy of your resume repo
                                             └► git push + GitHub PR (Octokit)
```

## Layout

| Path | What |
|---|---|
| `packages/shared` | Shared types, `validateJobPayload`, `slugify` |
| `apps/api` | Local Express server: `/runs` orchestration, SSE progress, honesty check |
| `apps/extension` | Chrome MV3 extension: capture posting, confirm, live progress, PR link |
| `example-resume-repo` | Template for your separate resume repo (incl. `SKILL.md`) |
| `docs/TESTING.md` | Setup + manual E2E runbook |

## Quick start

```sh
pnpm install
pnpm typecheck && pnpm test

# API
cd apps/api && cp .env.example .env   # fill in keys — see docs/TESTING.md
pnpm dev:api

# Extension
pnpm --filter @resume-tailor/extension dev
# chrome://extensions → Load unpacked → apps/extension/dist
```

Full setup, curl smoke tests, and the E2E runbook: [docs/TESTING.md](docs/TESTING.md).

## How a run works

1. `POST /runs` validates the confirmed job payload, locks the repo, returns `202 {runId}`.
2. The agent service clones your resume repo (depth 1) into a tmp dir, creates
   `resume/{company}-{title}-{shortId}`, and runs the Claude Agent SDK
   (`claude-sonnet-5`, tools: Read/Write/Edit/Bash/Grep/Glob) with a prompt that
   points at `.claude/skills/tailor-resume/SKILL.md` in your repo.
3. After the loop, an honesty check scans the diff for metrics/claims absent
   from your original resume — warnings surface in the PR body and popup, but
   never block.
4. Commit, push, open PR via Octokit, report `{prUrl, branch, filesChanged}`,
   clean up the tmp clone.
5. The extension popup streams progress from `GET /runs/:id/events` (SSE).

## Security notes

- All secrets in `apps/api/.env` (gitignored); never bundled into the extension.
- `/runs` requires the `X-Resume-Agent-Token` shared secret; CORS restricted to
  `API_ORIGIN_ALLOWLIST`.
- Error messages are sanitized (tokens, keys, tmp paths stripped) before storage.
