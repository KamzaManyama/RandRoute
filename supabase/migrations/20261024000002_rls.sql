-- =============================================================================
-- RandRoute — 2 of 4: row-level security (RLS)
-- Every user can only see and change their own rows. The anon (logged-out)
-- role gets no access to any table.
-- `(select auth.uid())` is wrapped in a select so Postgres evaluates it once
-- per query instead of once per row.
-- =============================================================================

-- Turn RLS on for every table ------------------------------------------------
alter table public.user_preferences       enable row level security;
alter table public.categories             enable row level security;
alter table public.statement_sources      enable row level security;
alter table public.statement_imports      enable row level security;
alter table public.transactions           enable row level security;
alter table public.staged_transactions    enable row level security;
alter table public.monthly_budgets        enable row level security;
alter table public.budget_category_limits enable row level security;
alter table public.ai_requests            enable row level security;

-- Logged-out visitors get nothing ---------------------------------------------
revoke all on public.user_preferences, public.categories, public.statement_sources,
              public.statement_imports, public.transactions, public.staged_transactions,
              public.monthly_budgets, public.budget_category_limits, public.ai_requests
  from anon;

-- -----------------------------------------------------------------------------
-- user_preferences: read/update own row. Rows are created by the sign-up
-- trigger and removed when the auth user is deleted, so no insert/delete.
-- -----------------------------------------------------------------------------
create policy "prefs_select_own" on public.user_preferences
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "prefs_update_own" on public.user_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- categories: everyone can read system categories; users manage their own.
-- -----------------------------------------------------------------------------
create policy "categories_select" on public.categories
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

create policy "categories_insert_own" on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "categories_update_own" on public.categories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "categories_delete_own" on public.categories
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- statement_sources, statement_imports, monthly_budgets: plain ownership
-- -----------------------------------------------------------------------------
create policy "sources_select_own" on public.statement_sources
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "sources_insert_own" on public.statement_sources
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sources_update_own" on public.statement_sources
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sources_delete_own" on public.statement_sources
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "imports_select_own" on public.statement_imports
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "imports_insert_own" on public.statement_imports
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "imports_update_own" on public.statement_imports
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "imports_delete_own" on public.statement_imports
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "budgets_select_own" on public.monthly_budgets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "budgets_insert_own" on public.monthly_budgets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "budgets_update_own" on public.monthly_budgets
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "budgets_delete_own" on public.monthly_budgets
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- transactions, staged_transactions, budget_category_limits:
-- ownership + any category used must be a system category or the user's own.
-- -----------------------------------------------------------------------------
create policy "transactions_select_own" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "transactions_insert_own" on public.transactions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (category_id is null or exists (
      select 1 from public.categories c
      where c.id = category_id and (c.user_id is null or c.user_id = (select auth.uid()))))
  );
create policy "transactions_update_own" on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (category_id is null or exists (
      select 1 from public.categories c
      where c.id = category_id and (c.user_id is null or c.user_id = (select auth.uid()))))
  );
create policy "transactions_delete_own" on public.transactions
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "staged_select_own" on public.staged_transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "staged_insert_own" on public.staged_transactions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (category_id is null or exists (
      select 1 from public.categories c
      where c.id = category_id and (c.user_id is null or c.user_id = (select auth.uid()))))
  );
create policy "staged_update_own" on public.staged_transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (category_id is null or exists (
      select 1 from public.categories c
      where c.id = category_id and (c.user_id is null or c.user_id = (select auth.uid()))))
  );
create policy "staged_delete_own" on public.staged_transactions
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "limits_select_own" on public.budget_category_limits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "limits_insert_own" on public.budget_category_limits
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.categories c
      where c.id = category_id and (c.user_id is null or c.user_id = (select auth.uid())))
  );
create policy "limits_update_own" on public.budget_category_limits
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.categories c
      where c.id = category_id and (c.user_id is null or c.user_id = (select auth.uid())))
  );
create policy "limits_delete_own" on public.budget_category_limits
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- ai_requests: users can read and add their own rows, but never edit or
-- delete them (so they can't reset their own rate limit).
-- -----------------------------------------------------------------------------
create policy "ai_requests_select_own" on public.ai_requests
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ai_requests_insert_own" on public.ai_requests
  for insert to authenticated with check ((select auth.uid()) = user_id);
