import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import type { ApiConfig } from "../config.js";
import { clearAllRuns, getRun, setStatus } from "../services/run-store.js";

const config: ApiConfig = {
  anthropicApiKey: "sk-ant-test",
  authToken: "route-test-token",
  port: 3847,
  originAllowlist: [],
};

const validJob = {
  title: "SWE",
  company: "Acme",
  url: "https://example.com/j",
  description: "d".repeat(220),
  confidence: "high",
  confirmed: true,
};

describe("runs routes", () => {
  const runAgent = vi.fn(async () => {});
  const app = createApp(config, runAgent);

  beforeEach(() => {
    clearAllRuns();
    runAgent.mockClear();
  });

  it("rejects an invalid job payload with 400", async () => {
    const res = await request(app)
      .post("/runs")
      .set("X-Resume-Agent-Token", config.authToken)
      .send({ job: { ...validJob, confirmed: false } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmed/);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("accepts a valid job, creates a run, and starts the agent", async () => {
    const res = await request(app)
      .post("/runs")
      .set("X-Resume-Agent-Token", config.authToken)
      .send({ job: validJob });
    expect(res.status).toBe(202);
    expect(res.body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(runAgent).toHaveBeenCalledWith(
      res.body.runId,
      expect.objectContaining({ title: "SWE" }),
    );
    expect(getRun(res.body.runId)?.status).toBe("submitting");
  });

  it("returns 404 for unknown run ids", async () => {
    const res = await request(app)
      .get("/runs/does-not-exist")
      .set("X-Resume-Agent-Token", config.authToken);
    expect(res.status).toBe(404);
  });

  it("returns the run record with status", async () => {
    const post = await request(app)
      .post("/runs")
      .set("X-Resume-Agent-Token", config.authToken)
      .send({ job: validJob });
    setStatus(post.body.runId, "running");

    const res = await request(app)
      .get(`/runs/${post.body.runId}`)
      .set("X-Resume-Agent-Token", config.authToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");
  });

  it("requires auth on all /runs endpoints", async () => {
    const res = await request(app).post("/runs").send({ job: validJob });
    expect(res.status).toBe(401);
  });
});
