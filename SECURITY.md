# Security Policy — RandRoute

## 1. Purpose

RandRoute is a personal finance application designed to help users understand their income, expenses, budgeting, transaction history, spending trends, and financial health. The app processes sensitive personal financial information, including bank statements, transaction data, income details, budget targets, and financial goals.

Because this data is highly sensitive, security is a release requirement and not a future enhancement. Every feature that handles user financial data must be implemented with privacy, access control, validation, and secure system design in mind.

This policy defines the minimum security requirements for development, testing, deployment, and production use of RandRoute.

---

## 2. Security Principles

RandRoute must follow these principles at all times:

- Privacy by design
- Least privilege
- Secure defaults
- Server-side enforcement
- Data minimisation
- Defense in depth
- Fail safely
- Explicit user consent for AI and financial automation
- No hidden trust in the browser
- No sensitive data in logs, analytics, or telemetry

---

## 3. Data Classification

### 3.1 Sensitive information

Treat the following as confidential:

- Uploaded bank statements
- Extracted statement contents and transaction text
- Amounts, dates, merchant names, categories, and transaction descriptions
- User profile information, emails, phone numbers, and account preferences
- Financial goals, income, debt, budgets, and savings targets
- AI prompts and responses containing financial data
- Authentication credentials, access tokens, session tokens, recovery codes, and refresh tokens
- Any data that could identify a user’s financial behavior

### 3.2 Data retention rules

- Do not permanently store uploaded bank statement PDFs unless there is a justified business requirement and an explicit approved retention policy.
- Do not retain raw extracted statement text unless specifically required for debugging, review, or legal retention reasons.
- Store only the cleaned transaction fields and derived summaries required for the app to function.
- Do not store unnecessary personal identifiers, full account numbers, identity numbers, addresses, or sensitive banking references.
- Temporary files created during statement parsing must be deleted after processing completes or fails.
- User deletion and account deletion must remove related records according to a documented retention policy.
- Backup retention must be disclosed and reviewed.

---

## 4. Security by Design

RandRoute must be built under the assumption that the browser is not a trusted security boundary.

The browser may be used to render content and collect user input, but it must not be trusted with:
- authentication secrets
- session secrets
- privileged database access
- AI provider credentials
- financial record ownership checks
- anything that can grant access to another user's data

All sensitive operations must be enforced on the server.

---

## 5. Authentication and Session Security

### 5.1 Mandatory auth model

RandRoute must use a secure, server-managed authentication model.

Recommended approach:
- Use a maintained authentication provider such as Supabase Auth or equivalent secure auth service.
- Use HttpOnly, Secure, SameSite cookies for sessions.
- Use short-lived access tokens and refresh tokens.
- Keep refresh tokens server-side and rotate them securely.
- Reject expired, invalid, or revoked sessions.
- Enforce session expiry and logout cleanup.

### 5.2 Forbidden patterns

The following are prohibited:

- Storing authentication tokens in localStorage
- Storing authentication tokens in sessionStorage
- Storing session tokens in URL query strings
- Storing access tokens in cookies without HttpOnly
- Exposing auth tokens in frontend JavaScript variables if they can be read by injected scripts
- Using bearer tokens in client-visible state for a production finance application

### 5.3 Cookie configuration

Session cookies must be configured with:

- HttpOnly: true
- Secure: true in production
- SameSite: Lax or Strict
- Path: /
- MaxAge or expiry policy appropriate to the session lifecycle
- Clear session cookie on logout

Do not rely on frontend-only route guards as the only protection.

### 5.4 Bearer tokens

If bearer tokens are used, they must:
- be short-lived
- be issued only by the backend
- not be stored in browser localStorage
- not be sent through URLs or logs
- be rotated properly
- be validated on every protected request

Prefer cookie-based sessions for finance workloads.

### 5.5 Session binding and scoping

Each session must be scoped to:
- the authenticated user
- the relevant app instance
- the expected device/browser context where appropriate
- the intended session lifetime

Sessions must not be transferable across users or accounts.

### 5.6 Logout and invalidation

- On logout, destroy the current session token or refresh token
- Clear all authentication cookies
- Invalidate the user session server-side
- Reject tokens after logout
- Revoke refresh tokens when session rotation is detected

---

## 6. Access Control and Authorisation

### 6.1 Required access controls

Every private endpoint must enforce server-side authorization.

- A user must not access another user’s data
- A user must not modify another user’s budgets
- A user must not view another user’s transactions
- A user must not access another user’s settings, statement metadata, AI history, or profile information
- A user must not perform administrative actions without appropriate roles

### 6.2 Ownership checks

The server must verify:
- user identity from a trusted auth context
- ownership of every relevant resource
- tenant or account scoped access where applicable
- permission levels before allowing mutations

Under no circumstances may the frontend decide which records belong to a user.

### 6.3 Preventing IDOR

The app must protect against insecure direct object reference attacks:

- Avoid trusting user IDs from the client
- Verify ownership before reading or updating records
- Validate object IDs before DB access
- Use server-side queries scoped to the authenticated user
- Reject resource access when the user ID does not match the authenticated account

### 6.4 Role-based access

If roles are introduced later, they must be enforced with explicit backend checks:
- admin
- user
- support
- system

Frontend route guards are not sufficient.

---

## 7. Cross-Site Request Forgery (CSRF) Protection

If the app uses cookies for authentication, CSRF protection is required.

### 7.1 Minimum requirements

- Use same-site cookies
- Validate Origin or Referer on sensitive state-changing requests
- Use anti-CSRF tokens for forms and API requests where appropriate
- Require CSRF checks for all non-GET state-changing actions

### 7.2 Cookie policy

- HttpOnly
- Secure
- SameSite=Lax or Strict
- Cookies should not be accepted cross-site unless explicitly required

### 7.3 Protected actions

CSRF protection must be implemented for:
- login
- logout
- signup
- password reset
- profile updates
- transaction creation/deletion
- budget modifications
- AI-triggering actions
- export requests
- delete account actions

---

## 8. Database Security

### 8.1 Server-side enforcement

If Supabase or another database is used, all user data must be protected by row-level security and/or trusted server-side validation.

### 8.2 Required rules

- Enable Row Level Security (RLS) on all tables with private user data
- Create explicit policies for SELECT, INSERT, UPDATE, and DELETE
- Validate ownership on every insert/update/delete
- Never trust a client-provided user_id
- Enforce foreign-key integrity
- Prevent mass data enumeration
- Reject unauthorised queries before data is returned
- Ensure support and admin actions are restricted

### 8.3 Secret management

- Store DB secrets only in server-side environment variables
- Never expose database credentials in frontend code, browser bundles, or Vite variables
- Keep service-role keys and privileged admin keys on the backend only
- Separate dev, staging, and production credentials

### 8.4 SQL injection prevention

- Use parameterized queries
- Avoid raw SQL concatenation from user input
- Validate input types and constraints
- Treat all client inputs as hostile

---

## 9. File Upload Security

Bank statement processing involves sensitive uploads and should be treated as a high-risk area.

### 9.1 Upload safeguards

- Accept only known supported file types
- Enforce a maximum file size limit
- Validate MIME type and file signature
- Reject malformed, oversized, or corrupted PDFs
- Reject encrypted or password-protected unsupported documents
- Reject suspicious or malicious uploads
- Store uploads in an isolated, restricted temp area
- Add upload rate limits and abuse prevention

### 9.2 Temporary file management

- Process files in a secure temp directory with restricted permissions
- Delete files after processing is complete
- Delete files after a failed processing attempt
- Delete files after cancellation or timeout
- Do not store raw PDFs as user records unless explicitly approved

### 9.3 PDF processing security

- Do not trust filename extensions or MIME types alone
- Do not treat uploaded PDFs as trusted instructions or executable content
- Do not render uploaded PDFs as HTML or script content
- Validate extracted transaction fields before saving
- Never log raw PDF content or raw extracted statement text
- Strip or sanitize any extracted values before use in downstream systems

---

## 10. AI Security Requirements

AI calls are high risk because they can expose financial and personal data.

### 10.1 AI access model

- AI must only run from a trusted backend service
- Frontend must never call the AI provider directly
- Frontend must never include AI provider keys
- Frontend must never call the database or financial logic service directly
- AI provider keys must remain server-side only

### 10.2 Mandatory consent

AI access must require explicit user consent.

- The user must take a deliberate action such as “Explain my spending”
- AI must not run automatically while the user is just viewing Insights
- AI must not run on page load
- AI must not run on timer or background refresh
- AI must not run when the user has not consented

### 10.3 Minimum data to send

The AI request must contain only the minimum safe summary required for the user request.

Examples of allowed fields:
- month
- income
- spending totals
- category totals
- budget status
- savings rate
- risk level
- top concerns
- user goals
- trend summary

Examples of forbidden fields:
- raw bank statements
- bank account numbers
- raw transaction text
- transaction descriptions that reveal sensitive merchant or personal data
- user email address
- full name
- phone number
- identity numbers
- full account details
- raw statements or PDFs
- free-form personal financial details not needed for the request

### 10.4 AI rate limiting

AI usage must be rate limited to protect cost and abuse.

Default policy:
- Maximum 5 AI requests per user per 24-hour period
- Maximum 1 AI request per user per rolling 10-minute window
- Maximum 20 AI requests per IP address per 15-minute window
- Maximum 100 AI requests total per service per 15-minute window

These limits may be tuned by environment, but the system must enforce a baseline.

### 10.5 AI request validation

- Validate the AI request before sending
- Reject empty or malformed payloads
- Reject requests without authentication
- Reject requests without user consent
- Reject requests when daily quota is reached
- Reject requests when the user has not completed required profile or setup data
- Validate AI response structure before displaying it

### 10.6 AI response handling

- Treat AI output as untrusted input
- Validate structured fields before rendering
- Sanitize text before display
- Do not allow AI output to execute commands or change system state directly
- Never allow AI to overwrite financial totals or budgets without explicit human approval
- Never present AI output as guaranteed financial advice
- Clearly label AI outputs as AI-generated

### 10.7 AI fallback behavior

If AI is unavailable or quota is exhausted:
- the app must continue to function
- core budgeting and transaction features must still work
- the user should receive an informative fallback message
- no financial totals must disappear due to AI failure

---

## 11. Web Application Security

The following web controls are mandatory where applicable:

- HTTPS only in production
- HSTS headers
- Content Security Policy (CSP)
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- CORS configured for trusted origins only
- Strict input validation on both frontend and backend
- Output encoding to reduce XSS
- Parameterized database queries
- Rate limiting on sensitive routes
- Safe error handling
- No stack traces or internal implementation details in user-facing errors

### 11.1 CORS

- Do not allow arbitrary wildcard origins
- Allow only known app origins
- If using cookies, CORS must support credentials and trusted origins only

### 11.2 Headers

The application must set relevant security headers on responses, including but not limited to:
- Content-Security-Policy
- Strict-Transport-Security
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy

### 11.3 Input validation

Every input must be validated on the backend before use.

This includes:
- login and signup payloads
- budget values
- transaction data
- file metadata
- URLs
- AI request data
- query parameters
- account deletion requests

Do not accept unsigned or untrusted input as valid.

---

## 12. Data Minimisation and Privacy

### 12.1 Public disclosure

- Do not expose user financial details in public docs, demos, or screenshots
- Do not include real transactions in public repositories
- Never commit real bank statements, personal financial data, or credentials to Git

### 12.2 User privacy

- Do not request unnecessary personal data
- Do not collect information not needed for the app
- Do not expose financial details to third-party services unless explicitly required and approved
- Do not display sensitive data in URLs, logs, or browser analytics
- Do not allow third-party vendors to process data without review

### 12.3 Retention

- Define and enforce data retention windows
- Delete expired data safely
- Provide deletion and export controls for users
- Describe retention periods in the privacy policy

---

## 13. Logging and Monitoring

### 13.1 Logging rules

- Never log passwords
- Never log session tokens or refresh tokens
- Never log raw bank statements
- Never log raw extracted statement text
- Never log full user financial data
- Never log AI prompts or responses with sensitive data
- Never log security-sensitive request payloads unless explicitly required for debugging and appropriately redacted

### 13.2 Log safety

Use safe logging patterns:
- request ID
- timestamp
- route
- status code
- minimal metadata
- redacted identifiers

### 13.3 Monitoring

The app must monitor:
- repeated failed login attempts
- suspicious API access
- failed access-control checks
- suspicious upload patterns
- rate-limit violations
- repeated AI usage attempts
- large numbers of failed requests from a single user/IP

---

## 14. Security Testing

Before production release, the app must pass at least the following checks:

- [ ] Authentication works correctly and cannot be bypassed
- [ ] Sessions are scoped correctly to the authenticated user
- [ ] No access to another user’s data is possible
- [ ] No tokens are stored in localStorage or sessionStorage
- [ ] Cookies are HttpOnly, Secure, and SameSite configured correctly
- [ ] Request validation and DTO checks are enforced on the backend
- [ ] CSRF protection is active for cookie-based auth
- [ ] Uploads are validated and cleaned up correctly
- [ ] Rate limiting is active on authentication and AI endpoints
- [ ] AI calls require explicit consent
- [ ] AI requests include only safe summary data
- [ ] Error responses do not leak secrets or internal data
- [ ] Logs are safe and do not expose sensitive financial information
- [ ] User deletion/removal works correctly
- [ ] API endpoints enforce authorisation and ownership checks
- [ ] Database policies reject cross-user access attempts
- [ ] Large or malicious uploads are rejected
- [ ] Dependency scanning is performed
- [ ] Security headers are present in production

---

## 15. Rate Limiting Policy

Rate limiting is mandatory to protect the app from abuse and excessive cost.

### 15.1 Default endpoint limits

- Authentication endpoints:
  - login: max 10 attempts per 15 minutes per IP
  - signup: max 5 per 15 minutes per IP
  - password reset: max 5 per 15 minutes per IP
  - account recovery: max 5 per 15 minutes per IP

- Public and general endpoints:
  - max 120 requests per minute per IP for public API traffic
  - max 300 requests per minute per IP for internal trusted traffic

- File upload endpoints:
  - max 5 uploads per 15 minutes per IP
  - max 2 heavy uploads per hour per user

- AI endpoints:
  - max 5 AI requests per user per 24 hours
  - max 1 AI request per user per 10 minutes
  - max 20 AI requests per IP per 15 minutes
  - max 100 AI requests per service per 15 minutes

- Financial mutation endpoints:
  - max 20 transaction writes per hour per user
  - max 10 budget changes per hour per user
  - max 5 account deletion requests per 24 hours per user

### 15.2 Rate-limit enforcement

- Enforce rate limiting on backend routes only
- Apply both per-IP and per-user limits where possible
- Return clear 429 responses with a retry-after header
- Log only rate-limit violations at a safe level
- Do not allow bypassing limits by rotating tokens or using alternate IDs

---

## 16. Incident Response

For a suspected or confirmed security incident:

1. Contain the issue
2. Restrict access to affected systems
3. Revoke or rotate suspected compromised credentials
4. Assess scope and impact
5. Preserve evidence without exposing user data
6. Remediate the vulnerable component
7. Recover safely
8. Notify affected users where legally required
9. Review and document the cause

Do not hide an incident or claim data was unaffected without evidence.

---

## 17. Security Ownership

The project maintainer is responsible for:
- reviewing security-sensitive changes
- updating dependencies and security controls
- maintaining deployment security
- ensuring user data protection
- overseeing AI and data-privacy controls
- ensuring security testing is performed before release

All contributors must follow this policy and must not commit secrets, bypass auth controls, or expose financial data.

---

## 18. Final Security Requirement

The app is handling personal and financial data. Therefore:

- the browser is not trusted
- sessions are not to be shared across users
- endpoints must be protected and enforced on the server
- AI must be explicit, consent-based, and rate limited
- file uploads must be validated and cleaned
- logs must be minimal and safe
- access control must be enforced at every layer
- the product must protect users’ financial information as a core responsibility

Security is not optional. It is a core part of the trust model for RandRoute.

---

## 19. Implementation Notes

The following architecture is recommended for the production version:

- Frontend: React or equivalent SPA
- Backend: Express, NestJS, Next API, or similar trusted API layer
- Database: Postgres with row-level security and ownership checks
- Auth: secure HttpOnly cookie sessions with refresh rotation
- AI: server-side only, explicit consent, rate limited
- Upload handling: secure temp processing and cleanup
- Logging: safe, minimal, structured, and redacted
- Monitoring: rate-limit violations, repeated failed auth, suspicious access, AI abuse

This policy is a minimum baseline. If a feature handles personal or financial information, it must be reviewed against this policy before release.
