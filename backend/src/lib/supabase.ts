import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config/env.js";

// The backend never keeps a session itself: each request brings its own token.
const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

export type SupabaseClients = {
  /** Fresh publishable-key client for auth calls (sign-up, sign-in, refresh). */
  auth: () => SupabaseClient;
  /** Client that acts as the signed-in user, so row-level security applies. */
  forUser: (accessToken: string) => SupabaseClient;
  /** Secret-key client. Bypasses RLS — admin tasks only (e.g. account deletion). */
  admin: SupabaseClient;
};

export function createSupabaseClients(config: AppConfig["supabase"]): SupabaseClients {
  return {
    auth: () => createClient(config.url, config.publishableKey, { auth: serverAuthOptions }),
    forUser: (accessToken) =>
      createClient(config.url, config.publishableKey, {
        auth: serverAuthOptions,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
    admin: createClient(config.url, config.secretKey, { auth: serverAuthOptions }),
  };
}
