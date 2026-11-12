import { randomUUID } from "node:crypto";
import path from "node:path";
import { Router } from "express";
import {
  validateJobPayload,
  JobPayloadValidationError,
} from "@resume-tailor/shared";
import type { CreateRunResponse } from "@resume-tailor/shared";
import type { ApiConfig } from "../config.js";
import {
  createRun,
  getRun,
  isTerminal,
} from "../services/run-store.js";
import { isRunActive, startAgentRun, TAILORED_RESUMES_DIR } from "../services/claude-agent.js";

const SSE_POLL_MS = 500;
const SSE_HEARTBEAT_MS = 15_000;
const SSE_HARD_CAP_MS = 2 * 60 * 60 * 1000; // 2 hours

export type StartAgentRunFn = typeof startAgentRun;

export function createRunsRouter(
  config: ApiConfig,
  runAgent: StartAgentRunFn = startAgentRun,
): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const job: unknown = req.body?.job;
    try {
      validateJobPayload(job);
    } catch (err) {
      if (err instanceof JobPayloadValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    if (isRunActive()) {
      res.status(409).json({
        error: "A run is already active. Wait for it to finish.",
      });
      return;
    }

    const runId = randomUUID();
    createRun(runId);
    // Fire and forget — progress is exposed via GET /runs/:id/events.
    void runAgent(runId, job);

    const response: CreateRunResponse = { runId };
    res.status(202).json(response);
  });

  router.get("/:id", (req, res) => {
    const record = getRun(req.params.id);
    if (!record) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(record);
  });

  // Serves a file the agent wrote, so a remotely-hosted instance's output is
  // fetchable — the container's disk isn't the caller's disk. Only paths
  // present in that run's own result.files are servable (no path traversal).
  router.get("/:id/files/*", (req, res) => {
    const record = getRun(req.params.id);
    if (!record?.result) {
      res.status(404).json({ error: "Run not found or has no result" });
      return;
    }

    const requested = (req.params as Record<string, string | undefined>)[0];
    if (!requested || !record.result.files.includes(requested)) {
      res.status(404).json({ error: "File not part of this run's result" });
      return;
    }

    const filePath = path.join(TAILORED_RESUMES_DIR, requested);
    res.download(filePath, path.basename(filePath), (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Failed to read file" });
      }
    });
  });

  router.get("/:id/events", (req, res) => {
    const runId = req.params.id;
    if (!getRun(runId)) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":connected\n\n");

    let cursor = 0;
    const startedAt = Date.now();

    const flush = (): boolean => {
      const record = getRun(runId);
      if (!record) return true;
      while (cursor < record.events.length) {
        const event = record.events[cursor];
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        cursor += 1;
      }
      return isTerminal(record.status);
    };

    const close = () => {
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
      res.end();
    };

    const pollTimer = setInterval(() => {
      const done = flush();
      if (done || Date.now() - startedAt > SSE_HARD_CAP_MS) {
        close();
      }
    }, SSE_POLL_MS);

    const heartbeatTimer = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, SSE_HEARTBEAT_MS);

    // Send whatever exists immediately; close now if already terminal.
    if (flush()) {
      close();
      return;
    }

    req.on("close", () => {
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
    });
  });

  return router;
}
