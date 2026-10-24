-- =============================================================================
-- RandRoute — 1 of 4: tables, types, indexes
-- Run in the Supabase SQL editor (or `supabase db push`) BEFORE files 2–4.
--
-- Money is always stored as integer cents (bigint *_minor columns), never floats.
-- We never store PDFs, raw statement text, account numbers, ID numbers or
-- statement-holder names.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Enum types
-- -----------------------------------------------------------------------------
create type public.import_status as enum (
  'staged',        -- rows extracted, waiting for the user to review
  'needs_review',  -- has uncertain rows or duplicate candidates
  'imported',      -- confirmed and saved
  'partial',       -- confirmed and saved, but validation found warnings
  'failed',        -- processing failed; nothing saved
  'cancelled'      -- user cancelled or staging expired; nothing saved
);

create type public.transaction_direction as enum ('inflow', 'outflow');

create type public.transaction_type as enum ('income', 'expense', 'transfer', 'refund', 'unknown');

create type public.review_status as enum (
  'auto_accepted',   -- reliable row, no review needed
  'needs_review',    -- uncertain extraction or category
  'user_confirmed',  -- user looked at it and accepted it
  'user_edited'      -- user changed a value
);

create type public.duplicate_decision as enum ('unresolved', 'keep_both', 'exclude');

create type public.ai_consent_status as enum ('not_asked', 'granted', 'withdrawn');

-- -----------------------------------------------------------------------------
-- Helper: keep updated_at current
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- User preferences (one row per user, created automatically on sign-up)
-- -----------------------------------------------------------------------------
create table public.user_preferences (
  user_id                     uuid primary key references auth.users (id) on delete cascade,
  display_name                text check (display_name is null or char_length(display_name) between 1 and 60),
  currency                    char(3) not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  monthly_budget_target_minor bigint check (monthly_budget_target_minor is null or monthly_budget_target_minor >= 0),
  savings_target_minor        bigint check (savings_target_minor is null or savings_target_minor >= 0),
  setup_completed_at          timestamptz,
  ai_consent_status           public.ai_consent_status not null default 'not_asked',
  ai_consent_updated_at       timestamptz,
  ai_consent_policy_version   text check (ai_consent_policy_version is null or char_length(ai_consent_policy_version) <= 20),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Categories. user_id IS NULL = system category shared by everyone (read-only).
-- -----------------------------------------------------------------------------
create table public.categories (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid references auth.users (id) on delete cascade,
  key                      text not null check (key ~ '^[a-z0-9_]{1,50}$'),
  name                     text not null check (char_length(name) between 1 and 60),
  default_transaction_type public.transaction_type not null default 'expense',
  sort_order               integer not null default 100,
  is_system                boolean generated always as (user_id is null) stored,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index categories_system_key_uq on public.categories (key) where user_id is null;
create unique index categories_user_key_uq on public.categories (user_id, key) where user_id is not null;

-- -----------------------------------------------------------------------------
-- Statement sources: a bank format + optional nickname ("FNB cheque", "Capitec")
-- -----------------------------------------------------------------------------
create table public.statement_sources (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank_format_key text not null check (bank_format_key ~ '^[a-z0-9_]{1,50}$'),
  nickname        text check (nickname is null or char_length(nickname) between 1 and 60),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id)
);

-- -----------------------------------------------------------------------------
-- Statement imports: one row per uploaded statement
-- -----------------------------------------------------------------------------
create table public.statement_imports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_id          uuid,
  bank_format_key    text not null check (bank_format_key ~ '^[a-z0-9_]{1,50}$'),
  period_start       date not null,
  period_end         date not null,
  status             public.import_status not null default 'staged',
  transaction_count  integer not null default 0 check (transaction_count >= 0),
  -- Structured, non-sensitive results only, e.g. {"has_warnings":true,"balance_check":"mismatch"}
  validation_summary jsonb not null default '{}'::jsonb,
  imported_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (period_end >= period_start),
  unique (id, user_id),
  foreign key (source_id, user_id)
    references public.statement_sources (id, user_id) on delete set null (source_id)
);

-- -----------------------------------------------------------------------------
-- Transactions: confirmed, saved records (the source of truth for all totals)
-- -----------------------------------------------------------------------------
create table public.transactions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  import_id                uuid not null,
  source_id                uuid,
  transaction_date         date not null,
  cleaned_description      text not null check (char_length(cleaned_description) between 1 and 200),
  amount_minor             bigint not null check (amount_minor > 0),  -- direction gives the sign
  direction                public.transaction_direction not null,
  category_id              uuid references public.categories (id) on delete set null,
  transaction_type         public.transaction_type not null default 'unknown',
  review_status            public.review_status not null default 'auto_accepted',
  extraction_confidence    numeric(4, 3) check (extraction_confidence between 0 and 1),
  category_confidence      numeric(4, 3) check (category_confidence between 0 and 1),
  refund_of_transaction_id uuid,
  excluded_from_totals     boolean not null default false,
  note                     text check (note is null or char_length(note) <= 500),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (id, user_id),
  check (refund_of_transaction_id is null or refund_of_transaction_id <> id),
  foreign key (import_id, user_id)
    references public.statement_imports (id, user_id) on delete cascade,
  foreign key (source_id, user_id)
    references public.statement_sources (id, user_id) on delete set null (source_id),
  foreign key (refund_of_transaction_id, user_id)
    references public.transactions (id, user_id) on delete set null (refund_of_transaction_id)
);

-- -----------------------------------------------------------------------------
-- Staged transactions: extracted rows waiting for review/confirmation.
-- Moved into public.transactions atomically by public.confirm_import().
-- -----------------------------------------------------------------------------
create table public.staged_transactions (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  import_id                   uuid not null,
  row_index                   integer not null check (row_index >= 0),
  transaction_date            date not null,
  cleaned_description         text not null check (char_length(cleaned_description) between 1 and 200),
  amount_minor                bigint not null check (amount_minor > 0),
  direction                   public.transaction_direction not null,
  category_id                 uuid references public.categories (id) on delete set null,
  transaction_type            public.transaction_type not null default 'unknown',
  review_status               public.review_status not null default 'needs_review',
  extraction_confidence       numeric(4, 3) check (extraction_confidence between 0 and 1),
  category_confidence         numeric(4, 3) check (category_confidence between 0 and 1),
  include                     boolean not null default true,
  duplicate_of_transaction_id uuid,
  duplicate_decision          public.duplicate_decision,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (import_id, row_index),
  -- A flagged duplicate must carry a decision (starts as 'unresolved').
  check (duplicate_of_transaction_id is null or duplicate_decision is not null),
  foreign key (import_id, user_id)
    references public.statement_imports (id, user_id) on delete cascade,
  foreign key (duplicate_of_transaction_id, user_id)
    references public.transactions (id, user_id) on delete set null (duplicate_of_transaction_id)
);

-- -----------------------------------------------------------------------------
-- Budgets
-- -----------------------------------------------------------------------------
create table public.monthly_budgets (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month                 date not null check (month = date_trunc('month', month)::date),  -- first day of month
  expected_income_minor bigint check (expected_income_minor is null or expected_income_minor >= 0),
  savings_target_minor  bigint check (savings_target_minor is null or savings_target_minor >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, month),
  unique (id, user_id)
);

create table public.budget_category_limits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  budget_id   uuid not null,
  category_id uuid not null references public.categories (id) on delete cascade,
  limit_minor bigint not null check (limit_minor >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (budget_id, category_id),
  foreign key (budget_id, user_id)
    references public.monthly_budgets (id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- AI request log: used for per-user rate limits. Stores NO prompts or answers.
-- -----------------------------------------------------------------------------
create table public.ai_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('explain_insight', 'budget_suggestion', 'ask')),
  status     text not null check (status in ('ok', 'failed', 'quota_exceeded', 'refused')),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index categories_user_idx               on public.categories (user_id);
create index statement_sources_user_idx        on public.statement_sources (user_id);
create index statement_imports_user_period_idx on public.statement_imports (user_id, period_start desc);
create index statement_imports_source_idx      on public.statement_imports (source_id);
create index transactions_user_date_idx        on public.transactions (user_id, transaction_date desc);
create index transactions_user_category_idx    on public.transactions (user_id, category_id);
create index transactions_import_idx           on public.transactions (import_id);
create index transactions_source_idx           on public.transactions (source_id);
create index transactions_category_idx         on public.transactions (category_id);
create index transactions_refund_of_idx        on public.transactions (refund_of_transaction_id);
create index transactions_description_trgm_idx on public.transactions
  using gin (cleaned_description extensions.gin_trgm_ops);
create index staged_transactions_user_idx      on public.staged_transactions (user_id);
create index staged_transactions_dup_idx       on public.staged_transactions (duplicate_of_transaction_id);
create index staged_transactions_category_idx  on public.staged_transactions (category_id);
create index budget_limits_user_idx            on public.budget_category_limits (user_id);
create index budget_limits_category_idx        on public.budget_category_limits (category_id);
create index ai_requests_user_created_idx      on public.ai_requests (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create trigger set_updated_at before update on public.user_preferences       for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.categories             for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.statement_sources      for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.statement_imports      for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.transactions           for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.staged_transactions    for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.monthly_budgets        for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.budget_category_limits for each row execute function public.set_updated_at();
