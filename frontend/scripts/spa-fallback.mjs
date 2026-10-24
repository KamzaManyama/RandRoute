// After `vite build`: serve the app for every page address (e.g. /sign-in, /statements/123).
// Vercel serves dist/404.html for paths without a file, so the app loads and
// React Router shows the right screen — even if the platform's rewrites aren't applied.
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../dist");
copyFileSync(resolve(dist, "index.html"), resolve(dist, "404.html"));
console.log("spa-fallback: wrote dist/404.html");
