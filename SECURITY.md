# Security Policy — RandRoute

## 1. Purpose

RandRoute is a personal finance platform designed to help users understand their spending, organise financial transactions, manage budgets, and plan ahead.

Because the application processes financial information, security and privacy must be considered throughout development, testing, deployment, and maintenance.

This document defines the minimum security requirements for the project.

## 2. Supported Versions

Security fixes should be prioritised for the latest actively maintained version of RandRoute.

| Version | Security support |
|---|---|
| Latest production release | Supported |
| Development branch | Fixes addressed before release where practical |
| Older releases | Not guaranteed |

## 3. Security Principles

RandRoute must follow these principles:

- **Privacy by design:** Collect and retain only the information required for the application's functionality.
- **Least privilege:** Users and services receive only the permissions they need.
- **Secure defaults:** New features must not weaken existing protections.
- **Server-side enforcement:** Authentication, authorisation, financial data access, and AI-provider calls must be enforced by trusted server-side components or database policies.
- **Data minimisation:** Sensitive information must not be exposed unnecessarily to third-party services, logs, analytics, or error reports.
- **Defence in depth:** Authentication, database access policies, validation, encryption, monitoring, and testing must work together.
- **Fail safely:** When a security check fails, protected data and operations must remain inaccessible.

## 4. Information Classification

### Sensitive information

Treat the following as confidential:

- Imported bank statements and extracted statement contents.
- Transaction descriptions, amounts, dates, and merchant information.
- Account identifiers, account-holder names, and banking references.
- Income, expenses, debts, budgets, and financial goals.
- AI prompts and responses that contain financial information.
- Authentication credentials, access tokens, session identifiers, and recovery tokens.

### Data retention

- Do not persist uploaded bank statement PDFs as permanent application records.
- Do not retain raw extracted statement text unless a documented, reviewed requirement explicitly justifies it.
- Store only the transaction fields and financial summaries required for the product.
- Avoid collecting identity numbers, full account numbers, addresses, or other unnecessary identifiers.
- Temporary files and processing artefacts must be deleted when processing is complete or abandoned, subject to documented operational requirements.
- Define and enforce retention and deletion rules for imported transactions, user accounts, backups, and derived financial data.

## 5. Authentication and Authorisation

- Use a maintained authentication provider rather than implementing password handling from scratch.
- Require authentication before accessing private financial data.
- Enforce authorisation on the server and at the database level.
- Ensure each user can access only their own transactions, statements metadata, budgets, insights, and profile information.
- Never rely on frontend route guards or hidden UI elements as the only access control.
- Use secure session handling, token expiry, and appropriate session invalidation.
- Provide secure account recovery and logout behaviour.
- Apply rate limits to authentication, recovery, and other sensitive endpoints.
- Never log passwords, authentication tokens, session cookies, or recovery secrets.

## 6. Supabase and Database Security

If Supabase is used, the following requirements apply:

- Enable Row Level Security (RLS) on every table containing private user data.
- Create explicit policies for `SELECT`, `INSERT`, `UPDATE`, and `DELETE` operations as applicable.
- Validate ownership on inserts and updates; do not trust a user ID supplied by the client.
- Ensure related records cannot be accessed by manipulating record IDs.
- Keep Supabase service-role keys and other privileged credentials exclusively in trusted server-side environments.
- Never expose privileged keys through Vite variables prefixed with `VITE_`, frontend bundles, public repositories, or browser requests.
- Apply least-privilege permissions to database roles and backend services.
- Test database policies with multiple test users, including attempts to access each other's records.
- Protect migrations, database backups, and administrative access.

**Release requirement:** No production deployment may rely solely on frontend filtering to isolate one user's financial data from another user's data.

## 7. Bank Statement Upload and Processing

Statement processing must be treated as a sensitive operation.

- Accept only documented, supported file types and enforce reasonable file-size limits.
- Validate file signatures and content rather than trusting filenames or MIME types alone.
- Generate safe internal filenames; never use user-supplied paths as filesystem paths.
- Protect against malicious or malformed PDFs, parser failures, oversized documents, and resource-exhaustion attacks.
- Process uploaded files in a controlled environment with restricted permissions.
- Avoid storing uploads in publicly accessible locations.
- Do not expose uploaded statements through predictable URLs.
- Do not render extracted content as trusted HTML.
- Validate extracted transaction fields and handle incomplete or malformed statements safely.
- Delete temporary uploads and intermediate extraction data after processing.
- Do not silently discard suspected duplicate transactions or uncertain categories; preserve user review and confirmation workflows.

Uploaded documents must never be treated as trusted instructions or executable content.

## 8. Financial Data Integrity

RandRoute must preserve the accuracy and traceability of financial records.

- Calculate monetary values in application code using integer cents or an appropriate exact-decimal representation.
- Do not rely on an AI model to calculate authoritative financial totals.
- Validate amounts, dates, currencies, transaction types, and category values.
- Use database transactions where necessary to prevent partial or inconsistent imports.
- Keep imported records distinguishable from user-edited records.
- Flag potential duplicates for review rather than silently deleting transactions.
- Clearly identify incomplete statement coverage and partial financial totals.
- Require user confirmation before consequential import, deletion, or bulk-edit operations.
- Never let AI-generated suggestions silently overwrite confirmed financial records or budgets.

## 9. AI and Third-Party Services

If Gemini or another AI provider is integrated:

- Invoke AI services only through a trusted backend.
- Keep provider API keys out of the frontend and source control.
- Send only the minimum de-identified financial summaries needed to fulfil the user's explicit request.
- Do not send original bank statement PDFs, raw extracted statement text, full account numbers, or unnecessary personal identifiers to an AI provider.
- Do not invoke AI automatically merely because the user opens the Insights screen.
- Treat AI output as untrusted input. Validate structured responses before displaying or saving them.
- Do not allow AI responses to execute database operations, alter permissions, or perform privileged actions directly.
- Review the provider's retention, training, processing-location, and privacy terms before sending real financial data.
- Provide a way for core budgeting and transaction features to continue when AI is unavailable.
- Never represent AI-generated explanations as verified financial advice.

## 10. Secrets and Environment Variables

- Store local development secrets in an ignored environment file such as `.env.local`.
- Commit an `.env.example` containing placeholder values only.
- Add environment files, private keys, certificates, tokens, and credential exports to `.gitignore` where appropriate.
- Configure production secrets through the hosting platform's secret-management facilities.
- Use separate credentials for development, testing, and production.
- Rotate exposed or suspected-compromised credentials immediately.
- If a secret is committed, revoke or rotate it; removing it from the latest commit alone is insufficient.

Never commit real credentials to GitHub, including in branches, logs, test fixtures, screenshots, or documentation.

## 11. Web Application Security

Implement and test the following controls where applicable:

- HTTPS for all production traffic.
- Appropriate Content Security Policy (CSP) and other security response headers.
- Input validation on both client and server.
- Context-appropriate output encoding to mitigate cross-site scripting (XSS).
- Parameterised database queries to prevent SQL injection.
- CSRF protection where cookie-based authentication and request patterns require it.
- Secure cookie attributes, including `Secure`, `HttpOnly`, and an appropriate `SameSite` policy, where cookies are used.
- Restrictive CORS configuration.
- Rate limiting and abuse protection on sensitive endpoints.
- Safe error responses that do not expose stack traces, SQL queries, secrets, or private financial data.
- Dependency and build-tool updates with security implications reviewed.
- Protection against insecure direct object references and broken access control.

Security controls must be implemented in the layer that can reliably enforce them; frontend-only protections are insufficient.

## 12. Logging and Monitoring

- Never log passwords, tokens, full bank statements, raw extracted statement text, or unnecessary financial identifiers.
- Avoid logging transaction descriptions and amounts unless a documented operational need justifies it.
- Use non-sensitive correlation identifiers for troubleshooting where possible.
- Record security-relevant events, such as repeated failed logins, access-control failures, suspicious upload activity, and administrative changes.
- Restrict access to logs and define retention periods.
- Ensure error-monitoring and analytics services do not automatically capture sensitive financial data.
- Investigate unexpected access patterns and suspected account compromise.

## 13. South African Privacy Requirements

RandRoute must be developed with the Protection of Personal Information Act (POPIA) in mind.

Before production launch:

- Identify the personal information processed and document the purpose for each category.
- Establish an appropriate lawful basis for processing and provide clear privacy notices.
- Implement reasonable technical and organisational safeguards.
- Define procedures for data access, correction, deletion, retention, and security incidents.
- Review third-party operators and cross-border processing arrangements where applicable.
- Determine applicable information-officer, breach-notification, and other legal obligations with qualified guidance where needed.

This section is an engineering baseline, not a statement that the application is legally compliant. Compliance must be assessed against the actual implementation and applicable law.

## 14. Vulnerability Reporting

Please do not publish exploitable vulnerabilities or sensitive user data in public issues.

Report suspected security vulnerabilities privately to the project maintainer through an established private communication channel. A dedicated security contact should be published before production launch.

Include, where safe:

- A concise description of the vulnerability.
- The affected component or endpoint.
- Steps to reproduce the issue.
- Potential impact and any practical mitigation.
- Relevant logs or screenshots with credentials and personal information removed.

Do not access, download, modify, or disclose another person's financial data to prove a vulnerability.

The project maintainer should acknowledge reports, assess severity, prioritise remediation, and coordinate disclosure after an appropriate fix is available.

## 15. Incident Response

For a suspected security incident:

1. **Contain:** Disable affected functionality, revoke compromised credentials, or restrict access where necessary.
2. **Assess:** Identify affected systems, users, data categories, and the likely scope of exposure.
3. **Preserve evidence:** Secure relevant logs and incident records without unnecessarily copying sensitive financial data.
4. **Remediate:** Patch the vulnerability, rotate secrets, correct permissions, and address the root cause.
5. **Recover:** Restore service safely and verify that the vulnerability is no longer exploitable.
6. **Notify:** Follow applicable legal and contractual notification requirements, including any POPIA obligations.
7. **Review:** Document the incident, its impact, and measures to prevent recurrence.

Do not conceal a confirmed incident or claim that user data was unaffected without evidence.

## 16. Security Testing Before Production

The release process must include, at minimum:

- [ ] Verify authentication and account-recovery flows.
- [ ] Test cross-user data isolation using separate test accounts.
- [ ] Test RLS policies and direct database/API access.
- [ ] Verify that privileged credentials never appear in frontend assets.
- [ ] Test malicious, malformed, oversized, and unsupported uploads.
- [ ] Verify temporary-file cleanup and error handling.
- [ ] Test validation of imported transactions and financial totals.
- [ ] Review AI requests for unnecessary personal or financial information.
- [ ] Check access controls on all sensitive endpoints.
- [ ] Review dependencies for known vulnerabilities.
- [ ] Verify production HTTPS, security headers, CORS, and rate limits.
- [ ] Confirm that logs and error reports do not leak sensitive data.
- [ ] Test account deletion and documented data-retention behaviour.
- [ ] Review production environment variables and deployment permissions.

High-impact security findings must be resolved before release.

## 17. Security Ownership

The project maintainer is responsible for:

- Reviewing security-sensitive changes.
- Maintaining dependency updates and deployment configuration.
- Ensuring security tests are included in the release process.
- Reviewing access policies and third-party integrations.
- Maintaining vulnerability-reporting and incident-response procedures.
- Updating this policy as the application evolves.

All contributors must avoid committing secrets, bypassing access controls, or introducing unreviewed handling of sensitive financial data.

---

**Security is a release requirement, not a future enhancement.** Any feature that handles financial information must meet the relevant requirements in this policy before being enabled in production.
