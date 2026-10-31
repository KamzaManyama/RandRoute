/**
 * Request-level security controls (SECURITY.md sections 7, 11, 13 and 15):
 * request IDs, safe security logging, rate limits, same-origin checks and
 * CSRF protection for cookie-based sessions.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { HttpError } from "./errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Request IDs and safe logging
// ---------------------------------------------------------------------------

/** Gives every request an ID that is safe to log and returned as X-Request-Id. */
export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

/** One-way, shortened identifier so logs can link events without holding the real value. */
export const redact = (value: string | undefined | null): string | null =>
  value ? createHash("sha256").update(value).digest("hex").slice(0, 12) : null;

export type SecurityEvent =
  | "rate_limited"
  | "origin_blocked"
  | "csrf_failed"
  | "client_header_missing"
  | "auth_failed"
  | "login_failed"
  | "password_check_failed"
  | "ai_limit"
  | "upload_rejected";

/**
 * Structured security log line. Contains only the event, request ID, method,
 * route, status and redacted identifiers — never bodies, tokens, emails or
 * financial data.
 */
export function securityLog(event: SecurityEvent, req: Request, extra: Record<string, string | number | boolean | null> = {}): void {
  if (process.env.NODE_ENV === "test" && !process.env.SECURITY_LOG_IN_TESTS) return;
  console.warn(
    JSON.stringify({
      level: "security",
      event,
      requestId: req.requestId ?? null,
      method: req.method,
      route: `${req.baseUrl}${req.route?.path ?? req.path}`,
      ip: redact(req.ip),
      user: redact(req.auth?.userId),
      at: new Date().toISOString(),
      ...extra,
    }),
  );
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

type LimitKey = "ip" | "user" | "global";

/** Local development only (e.g. seeding demo data): RATE_LIMITS=off. Never honoured in production. */
const rateLimitsOff = () => process.env.RATE_LIMITS === "off" && process.env.NODE_ENV !== "production";

/**
 * A rate limiter that answers with a clear 429, a Retry-After header and a
 * safe log line. "user" limits fall back to the IP before sign-in.
 */
export function limiter(options: {
  name: string;
  windowMs: number;
  limit: number;
  by: LimitKey;
  message?: string;
  skip?: (req: Request) => boolean;
}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => rateLimitsOff() || (options.skip?.(req) ?? false),
    keyGenerator: (req) =>
      options.by === "global" ? "global" : options.by === "user" && req.auth?.userId ? `u:${req.auth.userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`,
    handler: (req, res: Response, next) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const retryAfter = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : Math.ceil(options.windowMs / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      securityLog("rate_limited", req, { limit: options.name });
      next(new HttpError(429, "rate_limited", options.message ?? "Too many requests. Please wait a few minutes and try again."));
    },
  });
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
export const WINDOWS = { MINUTE, HOUR, DAY: 24 * HOUR };

// ---------------------------------------------------------------------------
// Same-origin and client checks (CSRF layer 1 and 2)
// ---------------------------------------------------------------------------

/** Custom header every API call must send. Browsers can't add it cross-site without a CORS preflight. */
export const CLIENT_HEADER = "x-randroute-client";
export const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Rejects state-changing requests whose Origin (or Referer) isn't the app
 * itself or a configured frontend origin.
 */
export function sameOriginOnly(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins.map((o) => originOf(o)).filter(Boolean));
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = originOf(req.get("origin")) ?? originOf(req.get("referer"));
    if (!origin) return next(); // non-browser client; still needs the client header and CSRF token
    const host = req.get("x-forwarded-host") ?? req.get("host");
    const sameHost = host ? new URL(origin).host === host : false;
    if (sameHost || allowed.has(origin)) return next();
    securityLog("origin_blocked", req);
    next(new HttpError(403, "forbidden", "Request blocked."));
  };
}

/** Every API call must say it comes from the RandRoute web app. */
export const requireClientHeader: RequestHandler = (req, _res, next) => {
  if (req.get(CLIENT_HEADER) === "web") return next();
  securityLog("client_header_missing", req);
  next(new HttpError(403, "forbidden", "Request blocked."));
};

// ---------------------------------------------------------------------------
// CSRF token (CSRF layer 3): double-submit with an HttpOnly cookie
// ---------------------------------------------------------------------------

export const newCsrfToken = () => randomBytes(32).toString("base64url");
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
export const isCsrfToken = (value: unknown): value is string => typeof value === "string" && TOKEN_SHAPE.test(value);

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The X-CSRF-Token header must match the HttpOnly CSRF cookie. A page on
 * another site can't read the token (CORS blocks the response) or the cookie.
 * Applies to every state-changing request, plus any route that opts in with
 * `always` (e.g. exports).
 */
export function requireCsrf(cookieName: string, { always = false } = {}): RequestHandler {
  return (req, _res, next) => {
    if (!always && SAFE_METHODS.has(req.method)) return next();
    const cookie: unknown = req.cookies?.[cookieName];
    const header = req.get(CSRF_HEADER);
    if (isCsrfToken(cookie) && header && sameToken(cookie, header)) return next();
    securityLog("csrf_failed", req);
    next(new HttpError(403, "csrf_invalid", "Your session check failed. Refresh the page and try again."));
  };
}
