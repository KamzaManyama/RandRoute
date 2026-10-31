// Creates (or resets) a demo account filled with six months of synthetic
// statements, imported through the real API. Development only.
//
// Needs the backend running (npm run dev). Run: npm run demo
// Prints a new password every time it runs.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildStatementPdf, capitecStyle, demoMonthStatement } from "../src/statements/fixtures.js";

const EMAIL = process.argv[2] ?? "kmanyama009+demo@gmail.com";
const API = process.env.DEMO_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}/api`;
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const password = Array.from(randomBytes(14), (b) => alphabet[b % alphabet.length]).join("") + "-7a";
const profile = { display_name: "Demo User" };

// 1. Create or reset the user (email already confirmed)
const existing = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === EMAIL);
let userId: string;
if (existing) {
  userId = existing.id;
  // Fresh data each run (delete imports first so account data cascades cleanly)
  await admin.from("statement_imports").delete().eq("user_id", userId);
  await admin.from("statement_sources").delete().eq("user_id", userId);
  await admin.from("monthly_budgets").delete().eq("user_id", userId);
  const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, user_metadata: profile });
  if (error) throw error;
} else {
  const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, user_metadata: profile });
  if (error) throw error;
  userId = data.user.id;
}
await admin
  .from("user_preferences")
  .update({ display_name: profile.display_name, monthly_budget_target_minor: 2_200_000 })
  .eq("user_id", userId);

// 2. Sign in through the API, like the app does
const headers = { "X-RandRoute-Client": "web" };
const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password }),
}).then((r) => r.json());
if (!login.session) throw new Error(`Login failed — is the backend running at ${API}? ${JSON.stringify(login)}`);
const auth = { ...headers, Authorization: `Bearer ${login.session.accessToken}` };

async function importPdf(name: string, bytes: Uint8Array, nickname?: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), name);
  if (nickname) form.append("nickname", nickname);
  const up = await fetch(`${API}/statements/upload`, { method: "POST", headers: auth, body: form }).then((r) => r.json());
  if (!up.importId) throw new Error(`Upload failed for ${name}: ${JSON.stringify(up)}`);
  await fetch(`${API}/statements/${up.importId}/accept-all`, { method: "POST", headers: auth });
  // Demo data only: synthetic statements, so warnings are acknowledged automatically.
  const done = await fetch(`${API}/statements/${up.importId}/confirm`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ acknowledgeWarnings: true }),
  }).then((r) => r.json());
  console.log(`  ${name}: ${done.saved ?? JSON.stringify(done)} transactions imported`);
}

// 3. Six full months of cheque-account statements, then one Capitec statement
console.log(`Importing demo statements for ${EMAIL}…`);
const now = new Date();
let opening = 1_250_000;
for (let i = 6; i >= 1; i--) {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
  const { spec, closingMinor } = demoMonthStatement(month, opening);
  await importPdf(`demo-fnb-${month}.pdf`, await buildStatementPdf(spec), "Cheque account");
  opening = closingMinor;
}
await importPdf("demo-capitec.pdf", await buildStatementPdf(capitecStyle), "Spending card");

console.log("\nDemo account ready:");
console.log(`  Email:    ${EMAIL}`);
console.log(`  Password: ${password}`);
