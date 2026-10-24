import type { ErrorRequestHandler, RequestHandler } from "express";

/** An error that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "not_found", "Not found."));
};

/**
 * Sends a consistent JSON error. Never logs request bodies, tokens, or
 * financial data — only the method, path, and error message.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // Malformed JSON bodies from express.json()
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "invalid_json", message: "Request body is not valid JSON." } });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "too_large", message: "Request is too large." } });
    return;
  }

  console.error(`[error] ${req.method} ${req.path}: ${err instanceof Error ? err.message : "unknown error"}`);
  res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Please try again." } });
};
