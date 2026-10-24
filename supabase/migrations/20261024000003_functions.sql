-- =============================================================================
-- RandRoute — 3 of 4: triggers and database functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Create a preferences row whenever someone signs up.
--    display_name is optional and comes from the sign-up metadata.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_preferences (user_id, display_name)
  values (
    new.id,
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 60), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. Keep statement_imports.transaction_count in sync when saved transactions
--    are added or deleted.
-- -----------------------------------------------------------------------------
create or replace function public.sync_import_transaction_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.statement_imports
       set transaction_count = transaction_count + 1
     where id = new.import_id;
    return new;
  else
    update public.statement_imports
       set transaction_count = greatest(transaction_count - 1, 0)
     where id = old.import_id;
    return old;
  end if;
end;
$$;

create trigger sync_import_transaction_count
  after insert or delete on public.transactions
  for each row execute function public.sync_import_transaction_count();

-- -----------------------------------------------------------------------------
-- 3. confirm_import: the single commit point for an import.
--    Moves included staged rows into transactions, deletes the staging rows,
--    and marks the import as imported — all in one database transaction, so a
--    failure leaves nothing half-saved.
--    Runs as the calling user (security invoker), so RLS still applies.
-- -----------------------------------------------------------------------------
create or replace function public.confirm_import(p_import_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_import     public.statement_imports;
  v_unresolved integer;
  v_saved      integer;
begin
  select * into v_import
    from public.statement_imports
   where id = p_import_id and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;

  if v_import.status not in ('staged', 'needs_review') then
    raise exception 'Import is not waiting for confirmation (status: %)', v_import.status
      using errcode = 'P0001';
  end if;

  select count(*) into v_unresolved
    from public.staged_transactions
   where import_id = p_import_id
     and include
     and duplicate_decision = 'unresolved';

  if v_unresolved > 0 then
    raise exception 'Resolve % duplicate candidate(s) before confirming', v_unresolved
      using errcode = 'P0001';
  end if;

  insert into public.transactions (
    user_id, import_id, source_id, transaction_date, cleaned_description,
    amount_minor, direction, category_id, transaction_type, review_status,
    extraction_confidence, category_confidence
  )
  select
    s.user_id, s.import_id, v_import.source_id, s.transaction_date, s.cleaned_description,
    s.amount_minor, s.direction, s.category_id, s.transaction_type,
    case when s.review_status = 'needs_review' then 'user_confirmed'::public.review_status
         else s.review_status end,
    s.extraction_confidence, s.category_confidence
  from public.staged_transactions s
  where s.import_id = p_import_id
    and s.include
    and s.duplicate_decision is distinct from 'exclude'
  order by s.row_index;

  get diagnostics v_saved = row_count;

  delete from public.staged_transactions where import_id = p_import_id;

  update public.statement_imports
     set status = case
                    when coalesce((validation_summary ->> 'has_warnings')::boolean, false)
                    then 'partial'::public.import_status
                    else 'imported'::public.import_status
                  end,
         imported_at = now()
   where id = p_import_id;

  return v_saved;
end;
$$;

revoke execute on function public.confirm_import(uuid) from public, anon;
grant  execute on function public.confirm_import(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. cancel_import: drop staged rows and mark the import cancelled.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_import(p_import_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.statement_imports
     set status = 'cancelled'
   where id = p_import_id
     and user_id = auth.uid()
     and status in ('staged', 'needs_review');

  if not found then
    raise exception 'Import not found or already finished' using errcode = 'P0002';
  end if;

  delete from public.staged_transactions where import_id = p_import_id;
end;
$$;

revoke execute on function public.cancel_import(uuid) from public, anon;
grant  execute on function public.cancel_import(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. delete_all_financial_records: "Delete all my financial data" in Profile.
--    Keeps the account and preferences; removes imports (and their
--    transactions), budgets, sources, and the user's own categories.
-- -----------------------------------------------------------------------------
create or replace function public.delete_all_financial_records()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  delete from public.statement_imports where user_id = v_uid;  -- cascades to transactions + staged rows
  delete from public.monthly_budgets   where user_id = v_uid;  -- cascades to category limits
  delete from public.statement_sources where user_id = v_uid;
  delete from public.categories        where user_id = v_uid;
end;
$$;

revoke execute on function public.delete_all_financial_records() from public, anon;
grant  execute on function public.delete_all_financial_records() to authenticated;

-- -----------------------------------------------------------------------------
-- 6. cleanup_stale_imports: cancel imports left in staging for over 24 hours.
--    Not callable by users. Schedule it with pg_cron (see bottom) or call it
--    from the backend with the service-role key.
-- -----------------------------------------------------------------------------
create or replace function public.cleanup_stale_imports()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale as (
    update public.statement_imports
       set status = 'cancelled'
     where status in ('staged', 'needs_review')
       and created_at < now() - interval '24 hours'
    returning id
  )
  delete from public.staged_transactions s
   using stale
   where s.import_id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.cleanup_stale_imports() from public, anon, authenticated;
grant  execute on function public.cleanup_stale_imports() to service_role;

-- Optional: run the cleanup every hour. Enable the pg_cron extension first
-- (Dashboard → Database → Extensions → pg_cron), then run:
--
--   select cron.schedule('randroute-cleanup-stale-imports', '0 * * * *',
--                        $$select public.cleanup_stale_imports()$$);
