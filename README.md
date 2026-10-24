# Accumen

**Personal finance clarity for South Africans.**

Accumen is a personal-finance web application that helps individuals understand their money by importing bank statement PDFs, reviewing categorised transactions, tracking spending, planning monthly budgets, and optionally getting AI-assisted explanations of their financial activity.

> **Project status:** Planning / specification stage. This repository defines the intended product and technical guardrails. Features are not considered implemented until built and tested.

## Contents

- [Product vision](#product-vision)
- [Problem and approach](#problem-and-approach)
- [Target users](#target-users)
- [MVP scope](#mvp-scope)
- [Primary navigation](#primary-navigation)
- [Core user journey](#core-user-journey)
- [Technical direction](#technical-direction)
- [Privacy and security principles](#privacy-and-security-principles)
- [Financial calculation rules](#financial-calculation-rules)
- [Repository structure](#repository-structure)
- [Development setup](#development-setup)
- [Quality and acceptance criteria](#quality-and-acceptance-criteria)
- [Roadmap](#roadmap)
- [Documentation](#documentation)

## Product vision

Give people a clear, trustworthy picture of their personal finances without requiring direct access to their bank accounts or making AI responsible for financial calculations.

Accumen is a statement-analysis and budgeting tool. It is **not** a bank, payment service, credit provider, investment adviser, or live banking application.

## Problem and approach

People may have financial information spread across statements, accounts, and months. Accumen aims to bring imported transactions into one searchable view and explain the results in plain language.

1. A user uploads a supported South African bank statement PDF.
2. Accumen extracts and normalises transaction rows.
3. The user reviews uncertain classifications and possible duplicates.
4. The user confirms which eligible transactions to import.
5. Accumen calculates spending, cash flow, category totals, and budget progress.
6. The user can explicitly request an AI explanation of a selected trend or summary.

Accumen must clearly label incomplete statement coverage. It must never imply that imported statement data is a live bank balance.

## Target users

Individuals in South Africa who want to:
- understand where their money goes;
- combine transaction history from more than one source;
- search past transactions;
- set monthly category budgets;
- compare spending over time; and
- optionally receive plain-language explanations of their own imported financial summaries.

## MVP scope

### Included
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
- Payments, money transfers, lending, investments, or credit scoring.
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

Profile and privacy settings are accessible separately. Desktop uses a left sidebar; mobile uses bottom navigation. Navigation should preserve the selected month and relevant filters when returning to a previous screen.

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

## Technical direction

The initial frontend direction is **React + Vite + TypeScript**, deployed on Vercel. Supabase is a candidate for authentication and persistent structured data. Gemini may be used for optional AI explanations.

These are planned choices, not claims that infrastructure has already been configured. Confirm current provider limits, pricing, data-processing terms, and security controls before production use.

### Architectural principles
- The application computes all exact financial figures.
- AI receives only the minimum de-identified summary needed for the user's explicit request.
- AI is invoked from a trusted server-side endpoint; secrets never appear in browser code.
- Core functionality remains usable when AI is unavailable or quota is exhausted.
- Server-side access controls and database row-level security (RLS) enforce user ownership.
- Money is represented as integer cents or exact decimal values, never binary floating-point arithmetic.
- Imports are staged and validated before they change saved financial records.
- Processing must clean up temporary data on success, failure, and cancellation.

## Privacy and security principles

Bank statements are highly sensitive. Privacy is a core product requirement, not a later enhancement.

- Do not retain original statement PDFs or raw extracted statement text as application records.
- Do not save unnecessary identifiers such as full account numbers, identity numbers, addresses, or statement-holder names.
- Store only the cleaned transaction fields needed to provide the product.
- Minimise transaction descriptions and exclude unnecessary identifiers before any AI request.
- Do not put statement contents, credentials, financial details, or secrets in application logs, analytics, or error reports.
- Never expose the Gemini API key or service-role credentials in frontend code.
- Use least-privilege access, RLS, and server-side authorisation.
- Explain AI use and obtain user consent before sending relevant data to an AI provider.
- If privacy or provider terms cannot be verified as acceptable, disable AI until they can.
- Provide clear controls to export records and delete an import, all financial records, or an account.
- Disclose any applicable infrastructure backup or retention period; do not promise immediate physical erasure where the provider cannot guarantee it.

See [`docs/PRIVACY_AND_SECURITY.md`](docs/PRIVACY_AND_SECURITY.md).

## Financial calculation rules

- **Income:** count confirmed income credits; not every incoming credit is income.
- **Spending:** include qualifying expenses while avoiding double-counting.
- **Transfers:** identify own-account transfers where possible and exclude them from income and spending totals.
- **Refunds:** link to the original expense when possible or classify separately to avoid inflating income.
- **Net cash flow:** money in minus money out according to documented classifications.
- **Budget remaining:** category limit minus qualifying spending for the selected period.
- **Duplicates:** flag likely matches for user review; never silently discard based only on date and amount.
- **Partial coverage:** show available figures with prominent partial/incomplete labels.
- **Recalculation:** category edits, transaction edits, exclusions, and deletions must update affected summaries and budgets.

See [`docs/FINANCIAL_RULES.md`](docs/FINANCIAL_RULES.md).

## Repository structure

```text
accumen/
├── README.md
├── docs/
│   ├── PRODUCT_SPEC.md
│   ├── SCREEN_SPECIFICATIONS.md
│   ├── DATA_MODEL.md
│   ├── PRIVACY_AND_SECURITY.md
│   ├── FINANCIAL_RULES.md
│   └── ROADMAP.md
├── public/
├── src/
├── .env.example
├── .gitignore
└── package.json
```

The `src/` and `public/` directories are placeholders until application development begins. Do not add secrets or real bank statements to this repository.

## Development setup

The repository is currently a specification starter. Once the React/Vite application has been scaffolded:

```bash
npm install
npm run dev
```

Use the scripts defined in `package.json`. Never commit `.env`, API keys, service-role keys, real bank statements, or personal financial data.

Create a local environment file from the template when one exists:

```bash
copy .env.example .env
```

The `copy` command is for Windows Command Prompt. In PowerShell, `Copy-Item .env.example .env` is equivalent.

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

## Roadmap

1. **Specification** — finalise product scope, screens, data model, financial rules, and privacy requirements.
2. **Foundation** — create the React/Vite/TypeScript app, design system, routing, authentication, and protected data access.
3. **Statement pipeline** — upload, extraction, normalisation, validation, review, duplicate decisions, and atomic import.
4. **Core finance UI** — Home, Statements, Spending, transaction details, and search/filtering.
5. **Budgets and insights** — budgets, trends, and transparent coverage indicators.
6. **Optional AI** — consent, minimal server-side context, explanation UI, quotas, and graceful failure.
7. **Hardening** — representative statement testing, security review, deletion/export verification, accessibility, and responsive QA.

## Documentation

- [Product specification](docs/PRODUCT_SPEC.md)
- [Detailed screen specifications](docs/SCREEN_SPECIFICATIONS.md)
- [Data model](docs/DATA_MODEL.md)
- [Privacy and security](docs/PRIVACY_AND_SECURITY.md)
- [Financial rules](docs/FINANCIAL_RULES.md)
- [Roadmap](docs/ROADMAP.md)

## Contribution and decision rule

Keep product behaviour consistent with this README and the detailed documents. If implementation constraints require a change to a privacy rule, calculation rule, or import behaviour, document and review the change before shipping it.

**Guiding principle:** Accumen should be transparent about what it knows, what it has inferred, and what data is missing.
"""
screens = r"""# Accumen — Detailed Screen Specifications

**Status:** Planning specification  
**Platform:** Responsive web application  
**Currency and locale:** South African rand (ZAR / R) by default  
**Primary user:** Individual managing personal finances

This document defines expected behaviour for the 16 primary screen groups. These specifications describe intended behaviour; they do not mean the screens have already been implemented.

## Global experience requirements

### Layout and navigation
- Desktop: persistent left sidebar with Home, Statements, Spending, Budget, and Insights.
- Mobile: bottom navigation with the same five destinations.
- Profile and privacy settings are reachable from the account/profile control.
- Preserve selected month, source, category, and search filters when returning from a detail screen where practical.
- Use consistent page titles, back actions, loading indicators, confirmations, and error messages.
- Every screen must have responsive layouts and accessible keyboard focus, labels, contrast, and semantic controls.

### Shared data presentation
- Display currency in ZAR using a consistent format, e.g. `R 1,250.00`.
- Show the selected period and relevant source filters near financial summaries.
- Distinguish money in, money out, transfers, refunds, and unknown/unclassified activity.
- Mark incomplete statement coverage clearly wherever it affects a total or comparison.
- Do not describe imported statement totals as a live bank balance.
- Never present a chart without a clear period, measure, and usable empty state.
- Provide loading, empty, error, and partial-data states for data-dependent views.

### Import safety
- An import is staged until the user confirms it.
- Failed or cancelled processing must not leave partially imported transactions.
- Uncertain categories and duplicate candidates must be visible before confirmation.
- Original PDFs and raw extracted text are temporary processing inputs only and must not be retained as application records.
- Do not log document contents, account identifiers, or transaction-level sensitive data.

---

## Screen 01 — Welcome

**Purpose:** Explain Accumen and help a new visitor begin safely.

**Content**
- Accumen name and short value proposition.
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

## Screen 02 — Create account / Sign in

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

## Screen 03 — Initial setup

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

## Screen 04 — Home dashboard

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
- Net cash flow follows the classifications in `FINANCIAL_RULES.md`.
- Transfers must not inflate income or spending.
- Totals based on partial coverage must be labelled.
- Never call imported totals a current bank balance.

**States**
- New user/no imports.
- Loading.
- Populated.
- Partial coverage.
- Data retrieval error with retry.
- No transactions in selected month.

## Screen 05 — Statements overview

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

## Screen 06 — Upload statement

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

## Screen 07 — Processing and validation

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

## Screen 08 — Transaction review

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
- Users may inspect the original PDF on their own device; Accumen must not retain a server-side copy to display it.
- Explain the effect of excluding a row on imported totals.

**States**
- Review required, all rows reliable, edited, validation warning, no usable transactions, recoverable processing error.

## Screen 09 — Duplicate review and import confirmation

**Purpose:** Resolve likely duplicates and make the import atomic and explicit.

**Content**
- New candidate transaction.
- Possible matching saved transaction.
- Match rationale, such as similar date, amount, description, source, or other evidence.
- User choices: exclude as duplicate, keep both, or return to review.
- Import summary: rows to save, rows explicitly excluded, unresolved items, statement period/source, and validation/balance discrepancies.

**Rules**
- Date and amount alone are not proof of duplication.
- Never silently exclude a transaction.
- Require decisions for unresolved duplicate candidates before final confirmation, or make their unresolved status and exclusion from the import explicit.
- Confirmation is the commit point: saved records change only after successful confirmation.
- If commit fails, do not leave a partial import.

**Interactions**
- Resolve each duplicate candidate.
- Return to Screen 08.
- Cancel without changing saved records.
- Confirm import and return to Screen 05 or Screen 04 with a clear success summary.

**States**
- No duplicate candidates, candidates awaiting review, ready to confirm, importing, success, commit failure.

## Screen 10 — Spending overview

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

## Screen 11 — Transaction details

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

## Screen 12 — Monthly budget

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
- Spending classification follows `FINANCIAL_RULES.md`.
- Negative remaining values must be allowed and clearly shown when a limit is exceeded.
- Missing imports must not be represented as zero spending without a coverage warning.

**States**
- No budget, editing, saved, on track, limit reached, exceeded, partial coverage, save failure.

## Screen 13 — Budget planning

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

## Screen 14 — Monthly insights

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
- Continue to Screen 15 for a question.

**Rules**
- Opening the screen must not call Gemini.
- AI runs only after a clear user action and applicable consent.
- All displayed figures are calculated by Accumen.
- Do not state that a trend is unusual without sufficient comparable data.
- Label partial periods and incomplete statement coverage.

**States**
- No history, insufficient comparison data, populated, partial coverage, AI not requested, AI unavailable/quota exhausted, analysis failure.

## Screen 15 — Ask Accumen

**Purpose:** Answer user questions about their imported financial records in plain language.

**Example questions**
- “Why did my transport spending increase?”
- “How much did I spend on subscriptions this month?”
- “What would happen if I reduced takeaway spending?”
- “Based on the records I imported, how much might I save?”

**Content**
- Question field.
- Optional period/category selectors.
- Submit action.
- Answer with supporting figures and caveats.
- Links to relevant transactions or summaries.
- Clear conversation action.

**Request flow**
1. User explicitly submits a question.
2. Server validates authentication, consent, and allowed scope.
3. Accumen computes the relevant figures.
4. Only the minimum de-identified summary needed is sent to Gemini.
5. The answer is shown with caveats and links to the supporting app data where possible.

**Rules**
- Gemini must not be the calculator or source of truth.
- Do not send PDFs, raw extracted statement text, credentials, full account numbers, or unnecessary identifiers.
- Never expose the API key in the browser.
- Rate-limit requests and handle provider quotas.
- Core features remain usable if AI is disabled.
- Do not present advice as guaranteed financial outcomes.

**States**
- Ready, generating, answer available, insufficient data, consent required, AI unavailable, quota exhausted, request failure, cleared conversation.

## Screen 16 — Profile and privacy settings

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

---

## Cross-screen data and consistency rules

- All totals must be derived from the same canonical transaction classification rules.
- Every saved transaction must belong to an authenticated user and a known import/source context where applicable.
- Month filters must use a consistent date/time convention.
- Changes to a transaction must update every affected screen's derived values.
- Partial statement coverage must be visible on Home, Spending, Budget, and Insights where relevant.
- AI answers must be traceable to computed figures and the data scope used for the answer.
- Do not expose sensitive values in URLs, analytics events, logs, or client-side error messages.

## Minimum screen QA checklist

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
"""
product = r"""# Accumen — Product Specification

## Summary
Accumen is a South African personal-finance web app that converts supported bank statement PDFs into user-reviewed transaction records, spending summaries, monthly budgets, and optional AI-assisted explanations.

## Product principles
1. Accuracy before automation.
2. User control over ambiguous transactions and duplicates.
3. Privacy by design.
4. Calculations remain deterministic and testable.
5. AI is optional, consent-based, and invoked only by explicit user action.
6. Incomplete data is disclosed rather than hidden.
7. Mobile web usability is a first-release requirement.

## Intended audience
Individuals who want to understand their spending and plan monthly budgets from records they choose to import.

## Version 1
Manual PDF upload; multiple tested South African bank formats; normalised transaction review; duplicate review; combined source-aware history; dashboard; spending; budgets; insights; optional AI explanations; export and deletion.

## Exclusions
No direct bank connections, payments, live balances, credit scoring, lending, or investment advice.

## Core journey
Authenticate → optional setup → upload PDF → validate/extract → review uncertain rows → resolve duplicate candidates → confirm import → inspect summaries → set budget → optionally request an AI explanation.

## Success criteria
- Users can import a supported statement without partial writes on failure.
- Imported transaction values and direction are validated.
- Users can correct classifications.
- Figures reconcile with documented rules.
- Partial coverage is obvious.
- Users can search historical records.
- AI is never called just by opening Insights.
- Sensitive source documents and unnecessary identifiers are not retained as application records.
"""
data_model = r"""# Accumen — Data Model

This is a logical starting point, not a final database migration. Review it against the chosen extraction workflow and Supabase schema before implementation.

## Entities

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

## Security and integrity
- Every user-owned table must enforce ownership through row-level security and server-side authorisation.
- Never trust a client-supplied `user_id` as proof of ownership.
- Use foreign keys and appropriate uniqueness constraints.
- Use atomic transactions for final import confirmation.
- Do not store original PDFs or raw extraction text as persistent application records.
- Avoid sensitive transaction data in logs and analytics.
- Deletion must remove related rows and invalidate derived summaries according to the retention policy.
"""
privacy = r"""# Accumen — Privacy and Security Requirements

## Data minimisation
- Do not retain original statement PDFs or raw extracted statement text as application records.
- Save only the cleaned transaction fields necessary for user-facing features.
- Avoid full account numbers, identity numbers, addresses, card numbers, statement-holder names, and other unnecessary identifiers.
- Clean transaction descriptions where possible without destroying information required to understand the transaction.
- Do not put sensitive values in logs, analytics, URLs, error messages, or telemetry.

## Temporary statement processing
- Use temporary storage only when necessary.
- Apply access controls, short-lived processing locations, and size limits.
- Clean temporary files and extracted text after success, failure, and cancellation.
- Ensure failed jobs and retry flows do not leave temporary files behind.
- Do not render an original server-retained PDF in the application.

## Authentication and access control
- Use a supported authentication provider and safe session handling.
- Enforce server-side authorisation for every private operation.
- Apply database row-level security to user-owned records.
- Never trust a user ID supplied by the browser.
- Keep service-role credentials and provider API keys on the server only.

## Optional AI
- AI is off until the user explicitly invokes an AI-assisted action and the required consent is present.
- Opening Insights does not call AI.
- Compute financial figures in application code.
- Send only the minimum de-identified summary necessary to answer the user's question.
- Never send the original PDF, raw extraction text, authentication secrets, or unnecessary identifiers.
- Review the AI provider's current terms, data handling, retention, training, and free-tier conditions before sending real financial data.
- If the terms or controls are unsuitable or unclear, disable AI.
- Handle quotas, timeouts, refusal, and outages without breaking core features.

## Export and deletion
- Provide export of saved user records in a practical format.
- Support deleting an individual import and its associated transactions.
- Support deleting all saved financial records.
- Support account deletion and related-record cleanup.
- Recalculate or invalidate derived summaries after deletion.
- Explain applicable infrastructure backup retention; do not promise instant deletion from all backups unless verified.

## Incident prevention checklist
- No secrets in Git.
- `.env` is ignored.
- `.env.example` contains names/placeholders only.
- No real bank statements in repository fixtures.
- Use synthetic or appropriately anonymised test data.
- Review database policies before production.
- Test cross-user access attempts.
- Review logs and error reporting for data leakage.
"""
financial = r"""# Accumen — Financial Calculation Rules

These rules are product requirements. Implement them in deterministic application code and cover them with tests.

## Monetary precision
- Store amounts as integer minor units (cents) or use an exact decimal representation.
- Never use binary floating-point values for financial arithmetic.
- Format amounts for display only at the presentation layer.

## Income
- Count only transactions classified as confirmed income.
- Do not classify every credit as income.
- Transfers, refunds, reversals, and account adjustments must not automatically count as income.

## Spending
- Count qualifying expenses.
- Exclude transfers from spending where they are identified as transfers.
- Avoid double-counting transactions across overlapping imports or duplicate records.
- Explain how refunds affect spending totals.

## Transfers
- Identify transfers between a user's own accounts where possible.
- Do not count an internal transfer as new income or new spending.
- If uncertain, flag for review instead of making an unqualified assumption.

## Refunds and reversals
- Link a refund to its original expense when possible.
- Otherwise classify it separately with clear reporting semantics.
- Avoid inflating income with refunds.

## Net cash flow
`Net cash flow = qualifying money in - qualifying money out`

The precise qualifying classifications must be shared across dashboard, spending, and insights views.

## Budgets
`Category remaining = category limit - qualifying category spending`

- Remaining can be negative.
- A limit being exceeded must be explicit.
- Partial statement coverage must be disclosed so missing transactions are not mistaken for zero spending.

## Period comparisons
- Define month boundaries consistently.
- Compare equivalent periods.
- Mark incomplete periods or statement coverage.
- Do not label a category increase as unusual without enough comparable history.

## Duplicate detection
- Generate candidates using multiple signals where possible.
- Date and amount alone are insufficient proof.
- Present candidates to the user.
- Never silently delete or exclude a suspected duplicate.

## Partial coverage
- Show figures calculated from available records with a visible partial-data label.
- Do not hide all totals until coverage is complete.
- Avoid presenting partial totals as definitive monthly totals.
"""
roadmap = r"""# Accumen — Roadmap

## Phase 1: Specification
- [ ] Review product scope and exclusions.
- [ ] Approve all 16 screen specifications.
- [ ] Confirm financial calculation semantics.
- [ ] Design the logical data model.
- [ ] Review privacy and AI-provider constraints.
- [ ] Define supported statement formats and test fixtures.

## Phase 2: Application foundation
- [ ] Scaffold React + Vite + TypeScript.
- [ ] Establish design tokens, responsive shell, and routing.
- [ ] Implement authentication and protected routes.
- [ ] Configure Supabase only after access-control and schema review.
- [ ] Add environment templates and secret-handling rules.

## Phase 3: Statement pipeline
- [ ] Implement PDF validation.
- [ ] Add one statement format end-to-end and test it.
- [ ] Add extraction, normalisation, and validation.
- [ ] Implement staged review.
- [ ] Implement duplicate-candidate review.
- [ ] Make final import atomic.
- [ ] Verify cleanup on success, failure, and cancellation.
- [ ] Add additional bank formats only after test coverage.

## Phase 4: Core finance experience
- [ ] Home dashboard.
- [ ] Statements overview.
- [ ] Spending overview and search.
- [ ] Transaction details and edits.
- [ ] Consistent totals and coverage warnings.

## Phase 5: Budgeting and insights
- [ ] Monthly budget.
- [ ] Budget planning.
- [ ] Monthly trends and comparison logic.
- [ ] Data sufficiency and partial-period indicators.

## Phase 6: Optional AI
- [ ] Verify provider terms and data-processing settings.
- [ ] Add explicit consent and invocation.
- [ ] Add server-side summary computation and minimisation.
- [ ] Add quota/rate-limit/error handling.
- [ ] Confirm AI outages do not block core features.

## Phase 7: Release readiness
- [ ] Cross-user access and RLS tests.
- [ ] Import atomicity and cleanup tests.
- [ ] Financial calculation tests.
- [ ] Export and deletion tests.
- [ ] Mobile, accessibility, and browser QA.
- [ ] Review logs, analytics, and client bundle for leaks.
"""
gitignore = """node_modules/
dist/
.vite/
.env
.env.*
!.env.example
coverage/
*.log
.DS_Store
Thumbs.db
"""
envexample = """# Add only non-secret client configuration here when required.
# Never put Gemini API keys or Supabase service-role keys in VITE_* variables.
# VITE_SUPABASE_URL=
# VITE_SUPABASE_ANON_KEY=
#
# Server-only secrets belong in the hosting provider's environment settings.
# GEMINI_API_KEY=
# SUPABASE_SERVICE_ROLE_KEY=# RandRoute
