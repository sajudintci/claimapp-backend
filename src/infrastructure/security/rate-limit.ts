import { NextFunction, Request, Response } from "express";
import { env } from "@/config/env";

type Entry = { count: number; resetAt: number };
const bucket = new Map<string, Entry>();

export const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const found = bucket.get(key);

  if (!found || found.resetAt < now) {
    bucket.set(key, { count: 1, resetAt: now + env.RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (found.count >= env.RATE_LIMIT_MAX) {
    return res.status(429).json({ message: "Too many requests" });
  }

  found.count += 1;
  return next();
};
