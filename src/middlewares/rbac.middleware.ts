import { NextFunction, Request, Response } from "express";

export const permit = (...allowed: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = req.auth?.roles ?? [];
    const ok = roles.some((r) => allowed.includes(r));
    if (!ok) return res.status(403).json({ message: "Forbidden" });
    return next();
  };
};
