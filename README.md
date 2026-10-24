# RandRoute

**Personal finance clarity for South Africans.**

RandRoute is a personal-finance web application that helps individuals understand their money by importing bank statement PDFs, reviewing categorised transactions, tracking spending, planning monthly budgets, and optionally getting AI-assisted explanations of their financial activity.

> **Project status:** Planning / specification stage. This document defines the intended product and technical guardrails. Features are not considered implemented until built and tested.

## Contents

1. [Product vision](#product-vision)
2. [Product principles](#product-principles)
3. [Problem and approach](#problem-and-approach)
4. [Target users](#target-users)
5. [MVP scope](#mvp-scope)
6. [Primary navigation](#primary-navigation)
7. [Core user journey](#core-user-journey)
8. [Success criteria](#success-criteria)
9. [Technical direction](#technical-direction)
10. [Screen specifications](#screen-specifications)
11. [Data model](#data-model)
12. [Privacy and security](#privacy-and-security)
13. [Financial calculation rules](#financial-calculation-rules)
14. [Repository structure](#repository-structure)
15. [Development setup](#development-setup)
16. [Quality and acceptance criteria](#quality-and-acceptance-criteria)
17. [Roadmap](#roadmap)
18. [Contribution and decision rule](#contribution-and-decision-rule)

---

## Product vision

Give people a clear, trustworthy picture of their personal finances without requiring direct access to their bank accounts or making AI responsible for financial calculations.

RandRoute is a statement-analysis and budgeting tool. It is **not** a bank, payment service, credit provider, investment adviser, or live banking application.

## Product principles

1. Accuracy before automation.
2. User control over ambiguous transactions and duplicates.
3. Privacy by design.
4. Calculations remain deterministic and testable.
5. AI is optional, consent-based, and invoked only by explicit user action.
6. Incomplete data is disclosed rather than hidden.
7. Mobile web usability is a first-release requirement.

## Problem and approach

People may have financial information spread across statements, accounts, and months. RandRoute brings imported transactions into one searchable view and explains the results in plain language.

1. A user uploads a supported South African bank statement PDF.
2. RandRoute extracts and normalises transaction rows.
3. The user reviews uncertain classifications and possible duplicates.
4. The user confirms which eligible transactions to import.
5. RandRoute calculates spending, cash flow, category totals, and budget progress.
6. The user can explicitly request an AI explanation of a selected trend or summary.

RandRoute must clearly label incomplete statement coverage. It must never imply that imported statement data is a live bank balance.

## Target users

Individuals in South Africa who want to:

- understand where their money goes;
- combine transaction history from more than one source;
- search past transactions;
- set monthly category budgets;
- compare spending over time; and
- optionally receive plain-language explanations of their own imported financial summaries.

## MVP scope

### Included in v1

- Email/password authentication, email verification, and account recovery.
- Manual PDF statement upload; no direct bank connections in v1.
- Support for multiple South African bank statement formats, with each advertised format tested before being marked supported.
- One combined financial picture across imported statements, with source labels and optional source filters.
- Transaction extraction, normalisation, categorisation, and user review.
- Duplicate-candidate warnings with user-controlled decisions.
- Search and filters across saved transaction history.
- Dashboard, spending summaries, monthly budgets, and monthly insights.
- Optional, explicitly requested AI explanations through a server-side Gemini integration.
- Export and deletion controls for saved financial records.
- Responsive desktop and mobile web experience.

### Not included in v1

- Direct bank integrations, open-banking connections, or live balances.
- Payments, money transfers, lending, investments, credit scoring, or investment advice.
- AI-generated arithmetic as a source of truth.
- Silent deletion of transactions because they appear duplicated.
- Retention of original statement PDFs or raw extracted statement text as application records.

## Primary navigation

Five primary destinations:

1. **Home** — current-month overview and recent activity.
2. **Statements** — import sources, statement history, status, and warnings.
3. **Spending** — category summaries and searchable transaction history.
4. **Budget** — monthly category limits and planning.
5. **Insights** — trends and optional AI-assisted explanations.

Profile and privacy settings are accessible separately. All screen sizes use a **left side navigation** (no bottom navigation): a persistent sidebar on desktop, collapsing to a slide-out side drawer opened from a menu button on mobile. Navigation should preserve the selected month and relevant filters when returning to a previous screen.

The visual style follows [`design.jpg`](design.jpg): a soft light-grey background, rounded white cards, black primary buttons and highlight cards, compact line charts, and generous spacing.

## Core user journey

1. Create an account or sign in.
2. Complete optional initial setup.
3. Upload a statement PDF and confirm its source and period.
4. Review extraction warnings, uncertain categories, and duplicate candidates.
5. Confirm the import.
6. Review the Home dashboard and Spending views.
7. Set or adjust a monthly budget.
8. Open Insights and explicitly request an AI explanation if wanted.
9. Export or delete saved data through Profile and privacy settings.

## Success criteria

- Users can import a supported statement without partial writes on failure.
- Imported transaction values and direction are validated.
- Users can correct classifications.
- Figures reconcile with documented rules.
- Partial coverage is obvious.
- Users can search historical records.
- AI is never called just by opening Insights.
- Sensitive source documents and unnecessary identifiers are not retained as application records.

---

## Technical direction

- **Frontend (`frontend/`):** React + Vite + TypeScript. It only calls the RandRoute backend API. It holds **no** Supabase keys and **no** Gemini key.
- **Backend (`backend/`):** Node.js + Express + TypeScript. It owns all calls to Supabase (auth and database) and Gemini.
- **Database and auth:** Supabase (Postgres + Supabase Auth). The SQL lives in [`supabase/migrations/`](supabase/migrations/).
- **AI:** Gemini, called only from the backend, only after an explicit user action.

```text
Browser (frontend) ──HTTPS + Bearer token──► Backend API ──► Supabase (Auth + Postgres with RLS)
                                                         └──► Gemini (optional, server-side only)
```

How the backend talks to Supabase:

- **Auth:** register, sign-in, refresh, and password recovery go through backend endpoints that call Supabase Auth. The frontend stores the returned session and sends `Authorization: Bearer <access token>` on each request.
- **User data:** for each request the backend builds a Supabase client with the user's access token, so Postgres row-level security applies to every query.
- **Admin-only tasks** (for example account deletion) use the service-role key, which exists only in backend environment variables.

Confirm current provider limits, pricing, data-processing terms, and security controls before production use.

### Architectural principles

- The application computes all exact financial figures.
- AI receives only the minimum de-identified summary needed for the user's explicit request.
- AI is invoked from a trusted server-side endpoint; secrets never appear in browser code.
- Core functionality remains usable when AI is unavailable or quota is exhausted.
- Server-side access controls and database row-level security (RLS) enforce user ownership.
- Money is represented as integer cents or exact decimal values, never binary floating-point arithmetic.
- Imports are staged and validated before they change saved financial records.
- Processing must clean up temporary data on success, failure, and cancellation.

---

## Screen specifications

**Platform:** Responsive web application
**Currency and locale:** South African rand (ZAR / R) by default
**Primary user:** Individual managing personal finances

This section defines expected behaviour for the 16 primary screen groups. These specifications describe intended behaviour; they do not mean the screens have already been implemented.

### Global experience requirements

#### Layout and navigation

- Desktop: persistent left sidebar with Home, Statements, Spending, Budget, and Insights.
- Mobile: the same left side navigation as a slide-out drawer opened from a menu button. No bottom navigation.
- Profile and privacy settings are reachable from the account/profile control.
- Preserve selected month, source, category, and search filters when returning from a detail screen where practical.
- Use consistent page titles, back actions, loading indicators, confirmations, and error messages.
- Every screen must have responsive layouts and accessible keyboard focus, labels, contrast, and semantic controls.

#### Shared data presentation

- Display currency in ZAR using a consistent format, e.g. `R 1,250.00`.
- Show the selected period and relevant source filters near financial summaries.
- Distinguish money in, money out, transfers, refunds, and unknown/unclassified activity.
- Mark incomplete statement coverage clearly wherever it affects a total or comparison.
- Do not describe imported statement totals as a live bank balance.
- Never present a chart without a clear period, measure, and usable empty state.
- Provide loading, empty, error, and partial-data states for data-dependent views.

#### Import safety

- An import is staged until the user confirms it.
- Failed or cancelled processing must not leave partially imported transactions.
- Uncertain categories and duplicate candidates must be visible before confirmation.
- Original PDFs and raw extracted text are temporary processing inputs only and must not be retained as application records.
- Do not log document contents, account identifiers, or transaction-level sensitive data.

### Screen 01 — Welcome

**Purpose:** Explain RandRoute and help a new visitor begin safely.

**Content**
- RandRoute name and short value proposition.
- Brief explanation: import statements, review transactions, understand spending, and plan budgets.
- Primary actions: **Create account** and **Sign in**.
- Short privacy summary: no direct bank connection in v1; uploaded documents are processed without being retained as application records.
- Link to fuller privacy information.

**Interactions**
- Create account opens Screen 02 in sign-up mode.
- Sign in opens Screen 02 in sign-in mode.
- Privacy link opens the privacy information view or section.

**States**
- Default welcome.
- Authentication service unavailable, with retry guidance if the user attempts to proceed.

**Acceptance criteria**
- Visitors can distinguish statement analysis from live banking.
- Privacy wording is clear and does not promise more than the implementation can guarantee.

### Screen 02 — Create account / Sign in

**Purpose:** Authenticate the user without collecting banking credentials or unnecessary identity data.

**Content**
- Email and password fields.
- Sign-up, sign-in, email verification, password recovery, and reset states.
- Clear field-level validation and authentication errors.

**Interactions**
- New account → verification flow → Screen 03.
- Returning user with setup complete → Screen 04.
- Returning user without completed setup → Screen 03.
- Password recovery sends the provider-supported recovery flow.

**Validation and security**
- Never request online-banking usernames, bank passwords, PINs, card details, identity numbers, or full account numbers.
- Do not reveal whether an arbitrary email address belongs to an account through recovery error messages.
- Protect authenticated routes and sessions using the chosen auth provider's recommended practices.

**States**
- Empty form, invalid input, submitting, verification required, success, incorrect credentials, rate limited, offline/provider failure.

### Screen 03 — Initial setup

**Purpose:** Set optional preferences before the user starts importing data.

**Content**
- Currency preference, defaulting to ZAR.
- Optional monthly budget target.
- Optional savings target.
- Short explanation of statement processing, partial coverage, and data handling.

**Interactions**
- Save and continue to Screen 04.
- Skip optional values and continue.
- Preferences can be changed later in Profile.

**Rules**
- Do not require income, savings, or budget values to use the app.
- Validate amounts as non-negative currency values.
- Do not infer that an optional budget target is a confirmed full budget.

**States**
- First setup, saving, saved, recoverable save failure.

### Screen 04 — Home dashboard

**Purpose:** Provide a quick, accurate overview of imported financial activity.

**Content**
- Selected month and month navigation.
- Money in, money out, and net cash flow.
- Budget progress where a budget exists.
- Category spending summary.
- Recent transactions.
- Statement coverage status and relevant warnings.
- Import statement shortcut.
- Link to Insights; opening it must not automatically invoke AI.

**Interactions**
- Change month and refresh summaries.
- Select a category to open Spending filtered to that category and period.
- Select a transaction to open Screen 11.
- Select import shortcut to Screen 06.
- Open Insights without triggering an AI request.

**Rules**
- Net cash flow follows the [financial calculation rules](#financial-calculation-rules).
- Transfers must not inflate income or spending.
- Totals based on partial coverage must be labelled.
- Never call imported totals a current bank balance.

**States**
- New user/no imports, loading, populated, partial coverage, data retrieval error with retry, no transactions in selected month.

### Screen 05 — Statements overview

**Purpose:** Show imported statement records and their processing/import status.

**Content per statement**
- Bank or source label and optional user-defined nickname.
- Statement period.
- Import date.
- Number of saved transactions.
- Status and warnings, including unresolved review items or validation discrepancies.

**Interactions**
- Start a new upload → Screen 06.
- Open statement details and its transactions.
- Continue unresolved transaction review → Screen 08.
- Filter by source, period, and status.
- Delete an import after explicit confirmation; remove its associated saved records and recalculate summaries.

**Rules**
- Do not show full account numbers.
- Failed imports must be distinguishable from successfully imported statements.
- A statement record must not imply complete month coverage unless the data supports that conclusion.

**States**
- No statements, processing, needs review, imported, partial/validation warning, failed, deleted.

### Screen 06 — Upload statement

**Purpose:** Select a statement and establish its source and reporting period.

**Content**
- PDF file picker/drop area.
- Detected bank format, with manual selection when detection is uncertain.
- Source nickname, optional.
- Statement period confirmation.
- Short privacy notice and supported-file guidance.

**Interactions**
- Select PDF.
- Confirm or correct the detected bank format and period.
- Start processing → Screen 07.
- Cancel and return to Statements.

**Validation**
- Reject unsupported file types, malformed or unreadable PDFs, oversized files, encrypted/password-protected documents when unsupported, and unrecognised formats.
- If the PDF appears scanned, use OCR only if the pipeline supports it and clearly report uncertainty.
- Do not retain the PDF after processing. Clean up temporary data on success, failure, and cancellation.

**States**
- Empty, file selected, detecting format, unsupported bank, invalid PDF, file too large, encrypted PDF, uncertain period, upload/processing start failure.

### Screen 07 — Processing and validation

**Purpose:** Extract transaction candidates and communicate processing progress and confidence.

**Processing stages**
1. Validate file and selected format.
2. Extract text or run OCR where supported.
3. Identify transaction rows and normalise dates, descriptions, debits, credits, and amounts.
4. Validate row structure and statement totals/balances where possible.
5. Classify likely transactions, transfers, and refunds.
6. Generate duplicate candidates without automatically discarding them.
7. Separate extraction confidence from category confidence.
8. Prepare a staged review batch.

**Content**
- Current stage and progress where reliable.
- Count of candidate rows, rows needing attention, and warnings.
- Plain-language description of detected problems.
- Cancel/retry controls.

**Interactions**
- Continue to Screen 08 when a review batch is ready.
- Cancel processing.
- Retry recoverable failures.

**Rules**
- Progress indicators must not fabricate exact percentages when progress is not measurable.
- No saved transaction changes occur until confirmation.
- Clean up temporary PDFs and extracted text on every terminal path.
- Never log raw extracted text.

**States**
- Processing, OCR in progress, ready for review, partially parsed, unsupported format, validation warning, cancelled, failed.

### Screen 08 — Transaction review

**Purpose:** Let the user correct uncertain extracted data and classifications before import.

**Transaction fields**
- Date.
- Cleaned description.
- Amount and debit/credit direction.
- Suggested category.
- Transaction type, where known.
- Extraction confidence and category confidence as separate signals.
- Review status.

**Interactions**
- Change category or transaction type.
- Correct date or amount when extraction is wrong.
- Mark a row for later attention.
- Include or exclude an eligible row.
- Inspect duplicate candidates.
- Continue to duplicate review and import confirmation.

**Rules**
- Reliable rows should not require needless manual approval one by one.
- Uncertain rows must be visually flagged.
- Editing an amount or date must re-run relevant validation.
- Users may inspect the original PDF on their own device; RandRoute must not retain a server-side copy to display it.
- Explain the effect of excluding a row on imported totals.

**States**
- Review required, all rows reliable, edited, validation warning, no usable transactions, recoverable processing error.

### Screen 09 — Duplicate review and import confirmation

**Purpose:** Resolve likely duplicates and make the import atomic and explicit.

**Content**
- New candidate transaction.
- Possible matching saved transaction.
- Match rationale, such as similar date, amount, description, source, or other evidence.
- User choices: exclude as duplicate, keep both, or return to review.
- Import summary: rows to save, rows explicitly excluded, unresolved items, statement period/source, and validation/balance discrepancies.

**Interactions**
- Resolve each duplicate candidate.
- Return to Screen 08.
- Cancel without changing saved records.
- Confirm import and return to Screen 05 or Screen 04 with a clear success summary.

**Rules**
- Date and amount alone are not proof of duplication.
- Never silently exclude a transaction.
- Require decisions for unresolved duplicate candidates before final confirmation, or make their unresolved status and exclusion from the import explicit.
- Confirmation is the commit point: saved records change only after successful confirmation.
- If commit fails, do not leave a partial import.

**States**
- No duplicate candidates, candidates awaiting review, ready to confirm, importing, success, commit failure.

### Screen 10 — Spending overview

**Purpose:** Explore spending by category and search the full saved transaction history.

**Content**
- Period/month selector.
- Source and category filters.
- Transaction search.
- Category totals.
- Income/expense trend visualisations when enough data exists.
- Recurring-payment candidates clearly labelled as estimates.
- Searchable transaction list.
- Coverage and data-quality notices.

**Interactions**
- Filter by month, date range, source, category, and transaction type.
- Search cleaned descriptions.
- Select a category to inspect its transactions.
- Select a transaction to open Screen 11.
- Clear filters and restore the default view.

**Rules**
- All saved transaction history must be searchable, not only the current month.
- Trend comparisons must use defined equivalent periods and disclose incomplete coverage.
- Recurring-payment detection is a candidate, not a confirmed fact.

**States**
- Empty, populated, filtered, no matches, partial coverage, loading, retrieval error.

### Screen 11 — Transaction details

**Purpose:** Inspect and correct one saved transaction.

**Content**
- Date, amount, cleaned description, source label, category, type, import reference, and optional user note.
- Clear indication if the transaction is a transfer, refund, or otherwise excluded from standard totals.

**Interactions**
- Change category/type.
- Edit extracted date, description, or amount with validation.
- Add/edit a note.
- Undo/cancel edits where supported.
- Delete transaction after confirmation.

**Rules**
- Never display a full account number or raw statement text.
- Changes recalculate affected category totals, monthly summaries, and budgets.
- No AI call is needed for ordinary transaction edits.
- Deletion must update the associated import's counts/status as appropriate.

**States**
- Viewing, editing, saved, validation error, save failure, deletion confirmation, deleted.

### Screen 12 — Monthly budget

**Purpose:** Compare planned category limits with qualifying spending.

**Content**
- Selected month.
- Category limits, spent amounts, and remaining amounts.
- Total planned spending.
- Optional savings target.
- Status such as on track, limit reached, or exceeded.
- Statement coverage warning when spending data is incomplete.

**Interactions**
- Add/edit a category limit.
- Remove a category from the plan.
- Copy a previous month's budget.
- Select a category to inspect contributing transactions.
- Open Screen 13 to plan or revise a budget.

**Rules**
- Remaining = limit minus qualifying spending.
- Spending classification follows the [financial calculation rules](#financial-calculation-rules).
- Negative remaining values must be allowed and clearly shown when a limit is exceeded.
- Missing imports must not be represented as zero spending without a coverage warning.

**States**
- No budget, editing, saved, on track, limit reached, exceeded, partial coverage, save failure.

### Screen 13 — Budget planning

**Purpose:** Help users create or adjust a realistic monthly plan.

**Content**
- Expected monthly income (optional).
- Essential expense categories.
- Flexible spending limits.
- Savings target.
- Proposed adjustments and calculated plan totals.

**Interactions**
- Enter or adjust values.
- Preview the proposed plan.
- Save or cancel.
- Optionally request AI suggestions; this must be an explicit action.

**Rules**
- Calculations are performed by application code, not Gemini.
- AI suggestions are advisory and must never silently overwrite a saved plan.
- Clearly distinguish user-entered estimates from observed imported transactions.
- Validate currency values and show when the proposed budget exceeds expected income.

**States**
- New plan, editing, preview, saved, invalid values, plan exceeds income, optional AI unavailable, save failure.

### Screen 14 — Monthly insights

**Purpose:** Explain trends using available, traceable data.

**Content**
- Selected month and comparison period.
- Changes in spending by category.
- Top categories.
- Budget performance.
- Unusual increases only when sufficient history exists.
- Data coverage and limitations.
- Explicit AI explanation action.

**Interactions**
- Change month/comparison period.
- Select a trend or category.
- Request an explanation or budget suggestion.
- Inspect supporting transactions.
- Continue to Explain my spending (Screen 15).

**Rules**
- Opening the screen must not call Gemini.
- AI runs only after a clear user action and applicable consent.
- All displayed figures are calculated by RandRoute.
- Do not state that a trend is unusual without sufficient comparable data.
- Label partial periods and incomplete statement coverage.

**States**
- No history, insufficient comparison data, populated, partial coverage, AI not requested, AI unavailable/quota exhausted, analysis failure.

### Screen 15 — Explain my spending (AI summary)

**Purpose:** Give a plain-language explanation of the user's own spending for a month, with practical ideas to improve. There is **no free-typed question box** — people can't steer the AI with unusual or unsafe questions; it only ever explains their own figures.

**Where:** The **Explain my spending** button in the Insights header (Screen 14), next to the month picker. Budget planning (Screen 13) has a separate, optional "Review my plan with AI".

**What the explanation contains** (always these three sections):
1. **Where your money went** — biggest categories, money in vs money out.
2. **What changed** — changes from last month, unusual spending, budget limits (or why there's nothing to compare).
3. **How you could improve** — 2–4 practical ideas based on their own categories and figures.

**Request flow**
1. User presses **Explain my spending**.
2. Server validates authentication, AI consent (current policy version) and the daily limit (20 per user).
3. RandRoute computes the month's figures.
4. Only the minimum de-identified summary (category totals, changes, budget status, coverage limitations) is sent to Gemini — never descriptions, PDFs, account numbers, names or emails.
5. The answer is shown labelled "Written by AI", with a "What was shared with the AI" panel.

**Rules**
- Gemini is never the calculator or source of truth.
- Never expose the API key in the browser.
- If the main model is busy, a backup model is tried once; if AI is unavailable, the app says so and all figures keep working.
- No investment, credit, tax or legal advice; no guaranteed outcomes.

**States**
- Not requested, consent required, generating, answer shown, AI switched off, daily limit reached, AI unavailable.

### Screen 16 — Profile and privacy settings

**Purpose:** Manage account access, preferences, AI consent, and personal data.

**Content**
- Email/account settings.
- Password/security controls supported by the auth provider.
- Currency and display preferences.
- Source labels/nicknames.
- AI consent status and explanation.
- Export saved financial records.
- Delete an individual import.
- Delete all saved financial records.
- Delete account.
- Privacy and data-retention information.

**Interactions**
- Update supported account preferences.
- Enable/withdraw AI consent.
- Request an export.
- Delete an import or all financial records with explicit confirmation.
- Start account deletion.

**Rules**
- Destructive actions require clear consequences and confirmation.
- Deleting an import deletes its associated saved transactions and updates derived summaries/budgets.
- Deleting all financial records removes the user's saved financial data and derived records according to the disclosed retention policy.
- Account deletion must cover related records and explain any unavoidable provider backup retention window.
- Never claim that data is instantly erased from every backup unless that guarantee is verified.

**States**
- Default, saving, export preparing/ready/failed, delete confirmation, deletion processing, deletion success, recoverable error.

### Cross-screen data and consistency rules

- All totals must be derived from the same canonical transaction classification rules.
- Every saved transaction must belong to an authenticated user and a known import/source context where applicable.
- Month filters must use a consistent date/time convention.
- Changes to a transaction must update every affected screen's derived values.
- Partial statement coverage must be visible on Home, Spending, Budget, and Insights where relevant.
- AI answers must be traceable to computed figures and the data scope used for the answer.
- Do not expose sensitive values in URLs, analytics events, logs, or client-side error messages.

### Minimum screen QA checklist

For each screen, verify:

- [ ] Desktop layout.
- [ ] Mobile layout.
- [ ] Keyboard navigation and visible focus.
- [ ] Loading state.
- [ ] Empty state.
- [ ] Error state and recovery path.
- [ ] Partial-data state where relevant.
- [ ] Correct navigation and preserved filters.
- [ ] No sensitive data leakage.
- [ ] Correct calculations and accessible labels.

---

## Data model

This is the logical model. The exact schema is in [`supabase/migrations/`](supabase/migrations/), which adds three supporting tables: `statement_sources` (bank format + nickname), `staged_transactions` (extracted rows waiting for review, moved into `transactions` by the `confirm_import` function in one step), and `ai_requests` (a rate-limit log that stores no prompts or answers).

### User preferences

- `user_id` — auth identity; unique.
- `currency` — defaults to `ZAR`.
- `setup_completed_at` — nullable.
- `ai_consent_status` / consent timestamp and policy version, if AI is enabled.
- Created/updated timestamps as appropriate.

### Statement import

- `id`
- `user_id`
- `source_label` or user-defined nickname
- `bank_format_key` — format identifier, not account credentials
- `period_start`, `period_end`
- `imported_at`
- `status` — staged, needs_review, imported, partial, failed, cancelled
- `transaction_count`
- `validation_summary` — structured non-sensitive results only
- Avoid storing PDF bytes, raw statement text, full account numbers, or unnecessary holder identifiers.

### Transaction

- `id`
- `user_id`
- `import_id`
- `source_id` or source label reference
- `transaction_date`
- `cleaned_description`
- `amount_minor` — integer cents, or a carefully chosen exact decimal representation
- `direction` — inflow/outflow
- `category_id`
- `transaction_type` — e.g. income, expense, transfer, refund, unknown
- `review_status`
- `extraction_confidence` — distinct from category confidence
- `category_confidence`
- Optional user note, only if needed
- Created/updated timestamps

### Category

- Stable category ID/key, display name, and whether it is system-provided or user-defined.
- Define how category changes affect reports and budgets.

### Monthly budget

- `id`
- `user_id`
- `month`
- Optional expected income
- Optional savings target
- Created/updated timestamps

### Budget category limit

- `id`
- `user_id`
- `budget_id`
- `category_id`
- `limit_minor` — integer cents
- Created/updated timestamps

### Optional cached monthly summary

Only introduce caching if needed. Treat transaction records and documented rules as the source of truth. A cached summary must be rebuildable and invalidated when contributing transactions change.

### Data integrity

- Every user-owned table must enforce ownership through row-level security and server-side authorisation.
- Never trust a client-supplied `user_id` as proof of ownership.
- Use foreign keys and appropriate uniqueness constraints.
- Use atomic transactions for final import confirmation.
- Do not store original PDFs or raw extraction text as persistent application records.
- Avoid sensitive transaction data in logs and analytics.
- Deletion must remove related rows and invalidate derived summaries according to the retention policy.

---

## Privacy and security

Bank statements are highly sensitive. Privacy is a core product requirement, not a later enhancement. For vulnerability reporting, see [SECURITY.md](SECURITY.md).

### Data minimisation

- Do not retain original statement PDFs or raw extracted statement text as application records.
- Save only the cleaned transaction fields necessary for user-facing features.
- Avoid full account numbers, identity numbers, addresses, card numbers, statement-holder names, and other unnecessary identifiers.
- Clean transaction descriptions where possible without destroying information required to understand the transaction.
- Do not put sensitive values in logs, analytics, URLs, error messages, or telemetry.

### Temporary statement processing

- Use temporary storage only when necessary.
- Apply access controls, short-lived processing locations, and size limits.
- Clean temporary files and extracted text after success, failure, and cancellation.
- Ensure failed jobs and retry flows do not leave temporary files behind.
- Do not render an original server-retained PDF in the application.

### Authentication and access control

- Use a supported authentication provider and safe session handling.
- Enforce server-side authorisation for every private operation.
- Apply database row-level security to user-owned records.
- Never trust a user ID supplied by the browser.
- Keep service-role credentials and provider API keys (including the Gemini key) on the server only.

### Optional AI

- AI is off until the user explicitly invokes an AI-assisted action and the required consent is present.
- Explain AI use and obtain consent before sending relevant data to an AI provider.
- Opening Insights does not call AI.
- Compute financial figures in application code.
- Send only the minimum de-identified summary necessary to answer the user's question.
- Never send the original PDF, raw extraction text, authentication secrets, or unnecessary identifiers.
- Review the AI provider's current terms, data handling, retention, training, and free-tier conditions before sending real financial data.
- If the terms or controls are unsuitable or unclear, disable AI.
- Handle quotas, timeouts, refusal, and outages without breaking core features.

### Export and deletion

- Provide export of saved user records in a practical format.
- Support deleting an individual import and its associated transactions.
- Support deleting all saved financial records.
- Support account deletion and related-record cleanup.
- Recalculate or invalidate derived summaries after deletion.
- Explain applicable infrastructure backup retention; do not promise instant deletion from all backups unless verified.

### Incident prevention checklist

- [ ] No secrets in Git.
- [ ] `.env` is ignored.
- [ ] `.env.example` contains names/placeholders only.
- [ ] No real bank statements in repository fixtures.
- [ ] Use synthetic or appropriately anonymised test data.
- [ ] Review database policies before production.
- [ ] Test cross-user access attempts.
- [ ] Review logs and error reporting for data leakage.

---

## Financial calculation rules

These rules are product requirements. Implement them in deterministic application code and cover them with tests.

### Monetary precision

- Store amounts as integer minor units (cents) or use an exact decimal representation.
- Never use binary floating-point values for financial arithmetic.
- Format amounts for display only at the presentation layer.

### Income

- Count only transactions classified as confirmed income.
- Do not classify every credit as income.
- Transfers, refunds, reversals, and account adjustments must not automatically count as income.

### Spending

- Count qualifying expenses.
- Exclude transfers from spending where they are identified as transfers.
- Avoid double-counting transactions across overlapping imports or duplicate records.
- Explain how refunds affect spending totals.

### Transfers

- Identify transfers between a user's own accounts where possible.
- Do not count an internal transfer as new income or new spending.
- If uncertain, flag for review instead of making an unqualified assumption.

### Refunds and reversals

- Link a refund to its original expense when possible.
- Otherwise classify it separately with clear reporting semantics.
- Avoid inflating income with refunds.

### Net cash flow

```text
Net cash flow = qualifying money in − qualifying money out
```

The precise qualifying classifications must be shared across dashboard, spending, and insights views.

### Budgets

```text
Category remaining = category limit − qualifying category spending
```

- Remaining can be negative.
- A limit being exceeded must be explicit.
- Partial statement coverage must be disclosed so missing transactions are not mistaken for zero spending.

### Period comparisons

- Define month boundaries consistently.
- Compare equivalent periods.
- Mark incomplete periods or statement coverage.
- Do not label a category increase as unusual without enough comparable history.

### Duplicate detection

- Generate candidates using multiple signals where possible.
- Date and amount alone are insufficient proof.
- Present candidates to the user.
- Never silently delete or exclude a suspected duplicate.

### Partial coverage

- Show figures calculated from available records with a visible partial-data label.
- Do not hide all totals until coverage is complete.
- Avoid presenting partial totals as definitive monthly totals.

### Recalculation

- Category edits, transaction edits, exclusions, and deletions must update affected summaries and budgets.

---

## Repository structure

```text
RandRoute/
├── README.md                 # This document — the single source of truth
├── SECURITY.md               # Security policy and vulnerability reporting
├── design.jpg                # Visual reference (we use a side nav, not the bottom nav shown)
├── supabase/
│   └── migrations/           # SQL to run in Supabase, in filename order
│       ├── 20261024000001_schema.sql            # tables, types, indexes
│       ├── 20261024000002_rls.sql               # row-level security policies
│       ├── 20261024000003_functions.sql         # sign-up trigger, confirm/cancel import, deletion
│       ├── 20261024000004_seed_categories.sql   # shared system categories
│       ├── 20261024000005_fix_count_trigger_cascade.sql  # lets accounts with transactions be deleted
│       └── 20261024000006_budgets_and_account.sql        # save_budget (atomic budget save)
├── backend/                  # Express + TypeScript API (owns Supabase + Gemini)
│   ├── src/
│   │   ├── config/env.ts     # validates environment variables at startup
│   │   ├── lib/              # Supabase and Gemini clients
│   │   ├── middleware/       # auth check, error handling
│   │   ├── routes/           # API routes
│   │   ├── app.ts            # builds the Express app
│   │   └── server.ts         # starts the server
│   ├── scripts/verify-migrations.mjs   # tests the SQL in an in-memory Postgres
│   └── .env.example
└── frontend/                 # React + Vite + TypeScript (calls the backend only)
    ├── src/
    │   ├── components/       # layout with side navigation, icons
    │   ├── pages/
    │   ├── lib/api.ts        # the single API client
    │   └── index.css         # design tokens
    └── .env.example
```

Do not add secrets or real bank statements to this repository.

---

## Development setup

### 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com). Pick the region closest to South Africa that's available.
2. Open **SQL Editor** and run each file in [`supabase/migrations/`](supabase/migrations/) **in filename order** (1 → 6). Each file runs on its own.
   - Or, with the Supabase CLI: `npx supabase link --project-ref <your-ref>` then `npx supabase db push`.
3. **Authentication → Sign In / Providers → Email**: keep Email enabled and turn on **Confirm email**.
4. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:4173`
   - Redirect URLs: add `http://localhost:4173/auth/callback`
5. **Authentication → Policies / Passwords**: set a minimum password length of at least 8.
6. Optional: enable the `pg_cron` extension and schedule the stale-import cleanup (see the bottom of the functions migration).

### 2. Configure and run the backend

```powershell
cd backend
Copy-Item .env.example .env     # then fill in the values below
npm install
npm run dev                     # http://localhost:4000
```

| Variable | Where to find it |
| --- | --- |
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_JWKS_URL` (optional) | `<project URL>/auth/v1/.well-known/jwks.json` |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → secret key (`sb_secret_...`). **Server only.** |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey). Leave `AI_ENABLED=false` until the provider terms are reviewed. |
| `GEMINI_MODEL` | Defaults to `gemini-3.8-flash` (older models such as `gemini-2.5-flash` are closed to new keys). |

Check the setup:

- `http://localhost:4000/api/health` → `{"status":"ok", ...}`
- `http://localhost:4000/api/health/db` → `{"database":"ok","systemCategories":24}` once the migrations have been run.

### 3. Run the frontend

```powershell
cd frontend
npm install
npm run dev                     # http://localhost:4173
```

In development, Vite forwards `/api` requests to the backend, so the frontend needs no `.env`. In production, set `VITE_API_BASE_URL` to the backend URL.

### Tests

| Command | What it checks |
| --- | --- |
| `cd backend && npm test` | Config, auth flows, PDF reading and statement parsing (synthetic PDFs), categorising, health and security |
| `cd backend && npm run test:db` | Applies all migrations to an in-memory Postgres and checks RLS, import confirmation, duplicates, and deletion |
| `cd frontend && npm test` | Sign-in/register/forgot password, side navigation, Statements upload → review → import |

### Sample statements and demo account

`cd backend && npm run demo` (with the backend running) creates or resets **kmanyama009+demo@gmail.com** with six months of synthetic statements and prints a new password.

`cd backend && npm run fixtures` writes two synthetic statements (FNB-style and Capitec-style, made-up data) to `backend/fixtures/`. Upload them on the Statements screen to try the full import flow. PDFs are git-ignored.

Bank formats are marked **beta** until each one is tested against real, anonymised statements. Every imported row is checked against the statement's running balance, and anything that doesn't match is flagged for review.

Never commit `.env`, API keys, service-role keys, real bank statements, or personal financial data.

---

## Quality and acceptance criteria

- [ ] Registration, sign-in, verification, and account recovery work.
- [ ] Each advertised bank PDF format is tested using representative fixtures.
- [ ] Extracted dates, amounts, debit/credit direction, and statement totals are validated where possible.
- [ ] Uncertain categories are flagged without forcing the user to review every reliable row.
- [ ] Duplicate candidates are presented before import confirmation.
- [ ] A failed or cancelled import does not leave partial saved transactions.
- [ ] Dashboard figures reconcile with the included transactions and documented rules.
- [ ] Partial statement coverage is clearly labelled.
- [ ] Users can search and filter all saved transactions by date, month, category, and source.
- [ ] Transaction edits recalculate affected summaries and budgets.
- [ ] Opening Insights does not call Gemini; AI runs only after an explicit user action.
- [ ] The application works when AI is unavailable or quota is exhausted.
- [ ] Original PDFs and raw extraction text are not retained as application records.
- [ ] User-owned records are protected by server-side authorisation and RLS.
- [ ] Export and deletion flows are tested and clearly explained.
- [ ] No secrets or sensitive financial data are exposed in logs or client bundles.
- [ ] Mobile layouts, loading states, empty states, and error states are tested.

---

## Roadmap

### Phase 1: Specification

- [ ] Review product scope and exclusions.
- [ ] Approve all 16 screen specifications.
- [ ] Confirm financial calculation semantics.
- [ ] Design the logical data model.
- [ ] Review privacy and AI-provider constraints.
- [ ] Define supported statement formats and test fixtures.

### Phase 2: Application foundation

- [ ] Scaffold React + Vite + TypeScript.
- [ ] Establish design tokens, responsive shell, and routing.
- [ ] Implement authentication and protected routes.
- [ ] Configure Supabase only after access-control and schema review.
- [ ] Add environment templates and secret-handling rules.

### Phase 3: Statement pipeline

- [ ] Implement PDF validation.
- [ ] Add one statement format end-to-end and test it.
- [ ] Add extraction, normalisation, and validation.
- [ ] Implement staged review.
- [ ] Implement duplicate-candidate review.
- [ ] Make final import atomic.
- [ ] Verify cleanup on success, failure, and cancellation.
- [ ] Add additional bank formats only after test coverage.

### Phase 4: Core finance experience

- [ ] Home dashboard.
- [ ] Statements overview.
- [ ] Spending overview and search.
- [ ] Transaction details and edits.
- [ ] Consistent totals and coverage warnings.

### Phase 5: Budgeting and insights

- [ ] Monthly budget.
- [ ] Budget planning.
- [ ] Monthly trends and comparison logic.
- [ ] Data sufficiency and partial-period indicators.

### Phase 6: Optional AI

- [ ] Verify provider terms and data-processing settings.
- [ ] Add explicit consent and invocation.
- [ ] Add server-side summary computation and minimisation.
- [ ] Add quota/rate-limit/error handling.
- [ ] Confirm AI outages do not block core features.

### Phase 7: Release readiness

- [ ] Cross-user access and RLS tests.
- [ ] Import atomicity and cleanup tests.
- [ ] Financial calculation tests.
- [ ] Export and deletion tests.
- [ ] Mobile, accessibility, and browser QA.
- [ ] Review logs, analytics, and client bundle for leaks.

---

## Contribution and decision rule

Keep product behaviour consistent with this document. If implementation constraints require a change to a privacy rule, calculation rule, or import behaviour, document and review the change here before shipping it.

**Guiding principle:** RandRoute should be transparent about what it knows, what it has inferred, and what data is missing.
