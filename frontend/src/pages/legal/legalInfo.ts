/**
 * Details shown on the policy pages. Keep `version` in step with
 * POLICIES_VERSION in backend/src/routes/auth.ts (recorded when people register).
 *
 * Set VITE_PRIVACY_CONTACT_EMAIL in frontend/.env before launch.
 */
export const LEGAL = {
  effectiveDate: '24 October 2026',
  version: '2026-10-24',
  contactEmail: (import.meta.env.VITE_PRIVACY_CONTACT_EMAIL as string | undefined) || '',
}
