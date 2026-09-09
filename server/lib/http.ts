import type { NextFunction, Request, Response } from "express";
import { ZodError, type TypeOf, type ZodTypeAny } from "zod";
import type { ApiError } from "../../shared/types.ts";

/** An error with an intended HTTP status. Anything else becomes a 500. */
export class HttpError extends Error {
  status: number;
  fields: Record<string, string> | undefined;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.fields = fields;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, message, fields);
export const unauthorized = (message = "Not signed in") => new HttpError(401, message);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Parse with zod, converting a failure into a 400 carrying per-field messages.
 *
 * Generic over the schema rather than over a result type, so `.default()` values are
 * reflected in the returned type instead of staying optional.
 */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, value: unknown): TypeOf<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw badRequest("Some fields need fixing", zodFields(result.error));
}

function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    fields[path] ??= issue.message;
  }
  return fields;
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    const body: ApiError = { error: error.message };
    if (error.fields) body.fields = error.fields;
    res.status(error.status).json(body);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({ error: "Some fields need fixing", fields: zodFields(error) } satisfies ApiError);
    return;
  }

  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Something went wrong on the server" } satisfies ApiError);
}
