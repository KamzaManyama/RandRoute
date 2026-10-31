-- =============================================================================
-- RandRoute — 7: payment channels, row validation flags, statement fingerprints,
-- expected income, and a stricter import confirmation.
--
-- * channel: HOW money moved (card, debit order, ATM…), kept separate from the
--   category (WHAT it was for).
-- * flags: why the parser wants a person to check a staged row.
-- * file_sha256: a one-way fingerprint of the uploaded PDF, so the same file
--   can't be imported twice. It can't be turned back into the statement.
-- * confirm_import now refuses to save rows nobody has reviewed, refuses an
--   empty import, and needs an explicit acknowledgement when the statement
--   failed a validation check.
-- =============================================================================

create type public.transaction_channel as enum (
  'card_purchase', 'debit_order', 'eft_payment', 'eft_received', 'atm_withdrawal',
  'cash_deposit', 'bank_fee', 'interest', 'prepaid', 'internal_transfer', 'reversal', 'unknown'
);

alter table public.staged_transactions
  add column channel public.transaction_channel not null default 'unknown',
  add column flags text[] not null default '{}'
    check (flags <@ array['balance_mismatch', 'direction_guessed', 'outside_period', 'future_date',
                          'large_amount', 'repeat_in_statement', 'fee_split', 'fee_unverified']::text[]);

alter table public.transactions
  add column channel public.transaction_channel not null default 'unknown';

create index transactions_user_channel_idx on public.transactions (user_id, channel);

alter table public.statement_imports
  add column file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');

create index statement_imports_user_sha_idx on public.statement_imports (user_id, file_sha256);

alter table public.user_preferences
  add column expected_monthly_income_minor bigint
    check (expected_monthly_income_minor is null or expected_monthly_income_minor >= 0);

-- The AI coach is a new kind of AI request.
alter table public.ai_requests drop constraint if exists ai_requests_kind_check;
alter table public.ai_requests add constraint ai_requests_kind_check
  check (kind in ('explain_insight', 'budget_suggestion', 'ask', 'coach'));

-- New system categories.
insert into public.categories (user_id, key, name, default_transaction_type, sort_order)
values
  (null, 'side_income', 'Side hustle & extra income', 'income', 15),
  (null, 'interest',    'Interest earned',            'income', 25)
on conflict (key) where user_id is null do update
  set name = excluded.name,
      default_transaction_type = excluded.default_transaction_type,
      sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- confirm_import, stricter. Error codes the API maps to messages:
--   P0002 not found · P0001 wrong status · RRDUP unresolved duplicates
--   RRREV rows still need review · RRACK warnings not acknowledged · RRNON nothing to import
-- -----------------------------------------------------------------------------
drop function if exists public.confirm_import(uuid);

create or replace function public.confirm_import(p_import_id uuid, p_acknowledge_warnings boolean default false)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_import     public.statement_imports;
  v_count      integer;
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

  select count(*) into v_count
    from public.staged_transactions
   where import_id = p_import_id and include and duplicate_decision = 'unresolved';
  if v_count > 0 then
    raise exception 'Resolve % duplicate candidate(s) before confirming', v_count using errcode = 'RRDUP';
  end if;

  select count(*) into v_count
    from public.staged_transactions
   where import_id = p_import_id and include and review_status = 'needs_review';
  if v_count > 0 then
    raise exception 'Check % row(s) marked for review before confirming', v_count using errcode = 'RRREV';
  end if;

  if coalesce((v_import.validation_summary ->> 'has_warnings')::boolean, false) and not p_acknowledge_warnings then
    raise exception 'This statement has validation warnings. Confirm you have checked them.' using errcode = 'RRACK';
  end if;

  insert into public.transactions (
    user_id, import_id, source_id, transaction_date, cleaned_description,
    amount_minor, direction, category_id, transaction_type, review_status,
    extraction_confidence, category_confidence, channel
  )
  select
    s.user_id, s.import_id, v_import.source_id, s.transaction_date, s.cleaned_description,
    s.amount_minor, s.direction, s.category_id, s.transaction_type, s.review_status,
    s.extraction_confidence, s.category_confidence, s.channel
  from public.staged_transactions s
  where s.import_id = p_import_id
    and s.include
    and s.duplicate_decision is distinct from 'exclude'
  order by s.row_index;

  get diagnostics v_saved = row_count;

  if v_saved = 0 then
    -- An import with no transactions would make a month look covered with zero spending.
    raise exception 'There are no rows to import. Include at least one row, or cancel this import.' using errcode = 'RRNON';
  end if;

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

revoke execute on function public.confirm_import(uuid, boolean) from public, anon;
grant  execute on function public.confirm_import(uuid, boolean) to authenticated;
