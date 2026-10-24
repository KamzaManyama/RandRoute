// Local development entry point: `npm run dev` / `npm start`.
// On Vercel the app is served from src/index.ts instead (no listen()).
// (Named devServer.ts so Vercel never mistakes it for the deployed entry point.)
import { buildApp } from "./bootstrap.js";

let built;
try {
  built = buildApp();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { app, config } = built;
app.listen(config.port, () => {
  console.log(`RandRoute API listening on http://localhost:${config.port}`);
  console.log(`AI explanations: ${config.ai.enabled ? "enabled" : "disabled"}`);
});
