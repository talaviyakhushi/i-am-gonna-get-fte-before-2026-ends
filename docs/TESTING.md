# Testing & manual E2E runbook

## Automated tests

```sh
pnpm install
pnpm --filter @resume-tailor/shared build
pnpm typecheck        # all workspaces, TS strict
pnpm test             # shared: validation + slugify · api: auth, run-store, routes,
                      # sponsorship + posting-age checks, pipeline, mocked runs (no network)
```

- `apps/api/src/services/tailoring-pipeline.test.ts` mocks `@anthropic-ai/sdk`.
  It covers each pipeline step: bullet selection and scoring, rewrite audit,
  correction/revert, spare backfill, summary rules, template compile.
- `apps/api/src/services/claude-agent.test.ts` mocks the pipeline. It covers
  the run flow: early exits, status sequence, file output, tracker row, error
  sanitization.

Job scanner filters:

```sh
npx tsx job-scanner/evals/run_eval.ts
```

## Setup (once)

1. **Resume source.** Fill in `example-resume-repo/profile.yaml` with your
   experience bullets. Check that `templates/resume-template.tex` has every
   `{{PLACEHOLDER}}` the pipeline fills in.
2. **API env.**
   ```sh
   cd apps/api
   cp .env.example .env
   # fill ANTHROPIC_API_KEY
   # AUTH_TOKEN: openssl rand -hex 32
   # API_ORIGIN_ALLOWLIST: fill after loading the extension (step 4)
   ```
3. **Build + load extension.**
   ```sh
   pnpm --filter @resume-tailor/extension dev   # dev build seeds localhost:3847
   ```
   Chrome → `chrome://extensions` → Developer mode → *Load unpacked* →
   `apps/extension/dist`. Note the extension ID.
4. **Finish env.** Set `API_ORIGIN_ALLOWLIST=chrome-extension://<extension-id>`
   in `apps/api/.env`.
5. **Extension options.** Right-click the extension icon → Options → set API
   URL (`http://localhost:3847`) and paste the same `AUTH_TOKEN`.

## Smoke test the API alone (curl)

```sh
pnpm dev:api    # or: pnpm --filter @resume-tailor/api dev

curl -s http://localhost:3847/health
# → {"ok":true}

# Auth required:
curl -s -X POST http://localhost:3847/runs -H 'Content-Type: application/json' -d '{}'
# → 401

# Start a run (200+ char description required). This makes real Claude calls.
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

A smoke-test run writes a real folder under `tailored-resumes/` and a tracker
row. Delete both afterwards.

## Full manual E2E

1. Start the API: `pnpm dev:api`. Confirm `/health` responds.
2. Open a real job posting (LinkedIn / Greenhouse / Lever) in Chrome.
3. Click the extension icon. The popup shows extracted title / company / URL /
   description. If confidence is low, edit the fields. On non-job-board pages
   use **Scan this page**.
4. Click **Looks right — tailor my resume**.
5. Watch the live log: `preparing → running → saving → succeeded`.
6. Popup shows the output folder (`tailored-resumes/{date}/{company}/{role}`)
   and any warnings. Compile `tailored-resume.tex` and review every rewritten
   bullet before sending.

## Failure modes to verify

| Scenario | Expected |
|---|---|
| Wrong/missing `X-Resume-Agent-Token` | 401, run never starts |
| Description < 200 chars | 400 with validation message |
| Second POST while a run is active | 409 |
| Posting says no visa sponsorship | run → `blocked`, no model calls |
| Posting's `datePosted` > 14 days old | run → `stale`; retry with override proceeds |
| Bad `ANTHROPIC_API_KEY` | run → `failed`, error sanitized (no key/paths leaked) |
| Ctrl-C during a run | server exits cleanly, in-flight run aborted |

## Notes

- Live progress uses `fetch` + ReadableStream (not `EventSource`), because
  `EventSource` can't send the auth header.
- Run state is in memory: restarting the API forgets old runs. Files already
  saved under `tailored-resumes/` stay.
- Secrets live only in `.env` files (gitignored). The extension bundle
  contains no keys. Verify with `grep -r "sk-ant" apps/extension/dist`.
