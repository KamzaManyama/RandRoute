// Creates (or resets) a confirmed test user in Supabase so you can sign in
// without waiting for a verification email. Development only.
//
// Usage:
//   npm run user:create -- <email> "<display name>"
//
// Prints a freshly generated temporary password once. It is not saved anywhere.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [email, displayName = ""] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run user:create -- <email> "<display name>"');
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to create test users with NODE_ENV=production.");
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in backend/.env");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 16 random characters from an unambiguous alphabet + a fixed suffix that
// satisfies typical "letters, digits and symbol" password rules.
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const password =
  Array.from(randomBytes(16), (b) => alphabet[b % alphabet.length]).join("") + "-7a";

const metadata = displayName ? { display_name: displayName } : {};

// Look for an existing user with this email.
let existing = null;
for (let page = 1; !existing; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  existing = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (data.users.length < 200) break;
}

let userId;
if (existing) {
  const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Updated existing user ${email} (password reset).`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Created user ${email}.`);
}

// Keep the display name in preferences in sync (the sign-up trigger only runs on create).
if (displayName) {
  const { error } = await admin
    .from("user_preferences")
    .update({ display_name: displayName.slice(0, 60) })
    .eq("user_id", userId);
  if (error) throw error;
}

console.log(`User id:            ${userId}`);
console.log(`Temporary password: ${password}`);
console.log("Change it after the sign-in screens are built.");
