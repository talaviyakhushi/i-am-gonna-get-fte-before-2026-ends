import { describe, it, expect, beforeEach } from "vitest";
import {
  appendEvent,
  clearAllRuns,
  createRun,
  getRun,
  isTerminal,
  setError,
  setResult,
  setStatus,
} from "./run-store.js";

describe("run-store", () => {
  beforeEach(() => {
    clearAllRuns();
  });

  it("creates a run in submitting state", () => {
    createRun("r1");
    const run = getRun("r1");
    expect(run?.status).toBe("submitting");
    expect(run?.events).toEqual([]);
  });

  it("returns undefined for unknown runs", () => {
    expect(getRun("nope")).toBeUndefined();
  });

  it("appends events in order", () => {
    createRun("r1");
    appendEvent("r1", { ts: 1, type: "assistant", data: { text: "a" } });
    appendEvent("r1", { ts: 2, type: "tool_call", data: { name: "Read" } });
    const events = getRun("r1")!.events;
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("assistant");
    expect(events[1]!.type).toBe("tool_call");
  });

  it("tracks status transitions and emits status events", () => {
    createRun("r1");
    setStatus("r1", "preparing");
    setStatus("r1", "running");
    setStatus("r1", "saving");
    const run = getRun("r1")!;
    expect(run.status).toBe("saving");
    expect(run.events.map((e) => e.type)).toEqual(["status", "status", "status"]);
  });

  it("stores result and error", () => {
    createRun("r1");
    setResult("r1", { outputDir: "acme/senior-engineer", files: ["f"] });
    setError("r1", "boom");
    const run = getRun("r1")!;
    expect(run.result?.outputDir).toBe("acme/senior-engineer");
    expect(run.error).toBe("boom");
  });

  it("ignores updates for unknown run ids", () => {
    expect(() => setStatus("missing", "failed")).not.toThrow();
    expect(() => appendEvent("missing", { ts: 1, type: "error", data: {} })).not.toThrow();
  });

  it("classifies terminal statuses", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("submitting")).toBe(false);
  });
});
