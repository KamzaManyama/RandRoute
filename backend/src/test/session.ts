import type { Test } from "supertest";

/** A well-formed CSRF token for tests (43 base64url characters). */
export const TEST_CSRF = "c".repeat(43);

/**
 * Makes a supertest request look like it came from the signed-in web app:
 * the app header, the HttpOnly session cookie and the matching CSRF token.
 * Test config isn't Secure, so cookie names have no __Host- prefix.
 */
export function asWebApp(req: Test, { access = "t" as string | null, csrf = true, cookies = [] as string[] } = {}): Test {
  const jar = [`rr_csrf=${TEST_CSRF}`, ...(access ? [`rr_access=${access}`] : []), ...cookies];
  req.set("X-RandRoute-Client", "web").set("Cookie", jar.join("; "));
  if (csrf) req.set("X-CSRF-Token", TEST_CSRF);
  return req;
}
