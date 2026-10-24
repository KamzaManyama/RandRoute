// Vercel entry point for the "backend" service (framework: express).
// Vercel runs the exported app as a function; it must not call listen().
// Environment variables are set in the Vercel project settings, not backend/.env.
import { buildApp } from "./bootstrap.js";

const { app } = buildApp();

export default app;
