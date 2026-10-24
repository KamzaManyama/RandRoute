// Vercel entry point for the "backend" service (framework: express).
// Vercel runs the exported app as a function; it must not call listen().
// Environment variables are set in the Vercel project settings, not backend/.env.
//
// The real app is loaded on the first request. If loading fails (for example a
// missing environment variable), every request gets a clear JSON error naming
// what's wrong — instead of Vercel's bare FUNCTION_INVOCATION_FAILED crash.
import express, { type RequestHandler } from "express";

let realApp: Promise<RequestHandler> | null = null;

function loadRealApp(): Promise<RequestHandler> {
  realApp ??= import("./bootstrap.js").then(({ buildApp }) => buildApp().app as unknown as RequestHandler);
  return realApp;
}

/** Turns a startup error into something safe to show: setting names only, never values. */
function describeStartupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const missing = [...message.matchAll(/^\s*-\s*([A-Z0-9_]+):/gm)].map((m) => m[1]);
  return {
    code: "server_misconfigured",
    message: missing.length
      ? "The server is missing required settings. Add them in Vercel → Project → Settings → Environment Variables, then redeploy."
      : "The server failed to start. Check the function logs in Vercel.",
    ...(missing.length ? { settings: missing } : {}),
  };
}

const app = express();
app.disable("x-powered-by");
app.use(async (req, res, next) => {
  try {
    const handler = await loadRealApp();
    handler(req, res, next);
  } catch (error) {
    realApp = null; // try again on the next request (e.g. after env vars are added)
    console.error("[startup]", error instanceof Error ? error.message : error);
    res.status(503).json({ error: describeStartupError(error) });
  }
});

export default app;
