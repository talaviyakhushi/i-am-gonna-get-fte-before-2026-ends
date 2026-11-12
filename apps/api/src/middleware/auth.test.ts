import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createAuthMiddleware } from "./auth.js";

function appWithAuth(token: string) {
  const app = express();
  app.use("/protected", createAuthMiddleware(token), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("auth middleware", () => {
  const app = appWithAuth("secret-token");

  it("rejects requests without the token header", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/X-Resume-Agent-Token/);
  });

  it("rejects requests with a wrong token", async () => {
    const res = await request(app)
      .get("/protected")
      .set("X-Resume-Agent-Token", "wrong");
    expect(res.status).toBe(401);
  });

  it("accepts requests with the correct token", async () => {
    const res = await request(app)
      .get("/protected")
      .set("X-Resume-Agent-Token", "secret-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
