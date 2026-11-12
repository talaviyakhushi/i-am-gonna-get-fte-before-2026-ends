# Testing & manual E2E runbook

## Automated tests

```sh
pnpm install
pnpm typecheck        # all workspaces, TS strict
pnpm test             # shared: validation + slugify · api: auth, run-store,
                      # honesty check, routes, mocked agent run (no network)
```

The mocked agent-run test (`apps/api/src/services/claude-agent.test.ts`) stubs
the Claude Agent SDK, simple-git, and Octokit — it asserts event mapping, the
status sequence, git/PR call order, branch naming, and error sanitization.

## Setup (once)

1. **Resume repo.** Create a private GitHub repo from `example-resume-repo/`
   (copy `resume.md` + `.claude/skills/tailor-resume/SKILL.md`). Replace the
   sample resume with your own.
2. **GitHub PAT.** Fine-grained token with `Contents: Read and write` and
   `Pull requests: Read and write` on that repo (or classic PAT with `repo`).
3. **API env.**
   ```sh
   cd apps/api
   cp .env.example .env
   # fill ANTHROPIC_API_KEY, GITHUB_TOKEN, RESUME_REPO_URL
   # AUTH_TOKEN: openssl rand -hex 32
   # API_ORIGIN_ALLOWLIST: fill after loading the extension (step 5)
   ```
4. **Build + load extension.**
   ```sh
   pnpm --filter @resume-tailor/extension dev   # dev build seeds localhost:3847
   ```
   Chrome → `chrome://extensions` → Developer mode → *Load unpacked* →
   `apps/extension/dist`. Note the extension ID.
5. **Finish env.** Set `API_ORIGIN_ALLOWLIST=chrome-extension://<extension-id>`
   in `apps/api/.env`.
6. **Extension options.** Right-click the extension icon → Options → set API
   URL (`http://localhost:3847`) and paste the same `AUTH_TOKEN`.

## Smoke test the API alone (curl)

```sh
pnpm dev:api    # or: pnpm --filter @resume-tailor/api dev

curl -s http://localhost:3847/health
# → {"ok":true}

# Auth required:
curl -s -X POST http://localhost:3847/runs -H 'Content-Type: application/json' -d '{}'
# → 401

# Start a run (200+ char description required):
TOKEN=<your AUTH_TOKEN>
DESC=$(printf 'x%.0s' {1..250})
RUN=$(curl -s -X POST http://localhost:3847/runs \
  -H "Content-Type: application/json" -H "X-Resume-Agent-Token: $TOKEN" \
  -d "{\"job\":{\"confirmed\":true,\"title\":\"Test Role\",\"company\":\"TestCo\",\"url\":\"https://example.com/j\",\"confidence\":\"high\",\"description\":\"$DESC\"}}")
RUN_ID=$(echo "$RUN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["runId"])')

# Watch live events (SSE):
curl -N "http://localhost:3847/runs/$RUN_ID/events" -H "X-Resume-Agent-Token: $TOKEN"

# Or poll the record:
curl -s "http://localhost:3847/runs/$RUN_ID" -H "X-Resume-Agent-Token: $TOKEN"
```

> First real run: point `RESUME_REPO_URL` at a **throwaway** public repo (with a
> `resume.md` + SKILL.md) before trusting it with your real resume repo.

## Full manual E2E

1. Start the API: `pnpm dev:api`. Confirm `/health` responds.
2. Open a real job posting (LinkedIn / Greenhouse / Lever) in Chrome.
3. Click the extension icon. The popup shows extracted title / company / URL /
   description. If confidence is low, edit the fields. On non-job-board pages
   use **Scan this page**.
4. Click **Looks right — tailor my resume**.
5. Watch the live log: `cloning → running (assistant + tool calls) → pushing →
   opening_pr → succeeded`.
6. Popup shows the PR link (plus honesty-check warnings if any claims looked
   fabricated). Open the PR, review `jobs/{company}/{role}/resume.md` and
   `fit-report.md`, merge or close.

## Failure modes to verify

| Scenario | Expected |
|---|---|
| Wrong/missing `X-Resume-Agent-Token` | 401, run never starts |
| Description < 200 chars | 400 with validation message |
| Second POST while a run is active for the same repo | 409 |
| Bad `GITHUB_TOKEN` | run → `failed`, error sanitized (no token/paths leaked) |
| Ctrl-C during a run | server exits cleanly, in-flight run aborted, tmp dir removed |

## Notes

- Live progress uses `fetch` + ReadableStream (not `EventSource`) because the
  auth header can't be sent by `EventSource`.
- Run state is in-memory: restarting the API forgets old runs (branches/PRs
  already pushed are unaffected).
- Secrets live only in `apps/api/.env` (gitignored). The extension bundle
  contains no keys — verify with `grep -r "sk-ant\|ghp_" apps/extension/dist`.
