import { timingSafeEqual, createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export const AUTH_HEADER = "x-resume-agent-token";

function safeEqual(a: string, b: string): boolean {
  // Hash both sides so buffers are equal length regardless of input.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createAuthMiddleware(expectedToken: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = req.header(AUTH_HEADER);
    if (!provided || !safeEqual(provided, expectedToken)) {
      res.status(401).json({ error: "Missing or invalid X-Resume-Agent-Token" });
      return;
    }
    next();
  };
}
