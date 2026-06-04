import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";

export const validateBody = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.fail({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        error: {
          type: "ValidationError",
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }
    req.body = parsed.data;
    return next();
  };
};
