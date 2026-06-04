import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config/env";

export type AuthPayload = { sub: string; org: string; email: string; roles?: string[] };

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthPayload;
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.fail({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
      error: { type: "AuthError" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    req.auth = payload;
    return next();
  } catch {
    return res.fail({
      status: 401,
      code: "INVALID_TOKEN",
      message: "Invalid token",
      error: { type: "AuthError" },
    });
  }
};
