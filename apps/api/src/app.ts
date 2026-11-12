import express, { type Express } from "express";
import cors from "cors";
import type { ApiConfig } from "./config.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createRunsRouter, type StartAgentRunFn } from "./routes/runs.js";

export function createApp(config: ApiConfig, runAgent?: StartAgentRunFn): Express {
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser clients (curl, background fetch without Origin).
        if (!origin || config.originAllowlist.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin not allowed: ${origin}`));
        }
      },
      allowedHeaders: ["Content-Type", "X-Resume-Agent-Token"],
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/runs", createAuthMiddleware(config.authToken), createRunsRouter(config, runAgent));

  return app;
}
