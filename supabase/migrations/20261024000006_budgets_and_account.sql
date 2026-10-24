-- =============================================================================
-- RandRoute — 6: save a monthly budget in one step
--
-- save_budget replaces a month's plan (income, savings target and every
-- category limit) atomically, so a failed save never leaves half a budget.
-- Runs as the calling user (security invoker), so RLS still applies — a user
-- can only save their own budget and only use their own or system categories.
-- =============================================================================

create or replace function public.save_budget(
  p_month date,
  p_expected_income_minor bigint,
  p_savings_target_minor bigint,
  p_limits jsonb -- [{"category_id": "...", "limit_minor": 123400}, ...]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_budget_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_limits, '[]'::jsonb)) <> 'array' then
    raise exception 'Limits must be a list' using errcode = '22023';
  end if;

  insert into public.monthly_budgets (user_id, month, expected_income_minor, savings_target_minor)
  values (v_uid, p_month, p_expected_income_minor, p_savings_target_minor)
  on conflict (user_id, month) do update
    set expected_income_minor = excluded.expected_income_minor,
        savings_target_minor  = excluded.savings_target_minor
  returning id into v_budget_id;

  delete from public.budget_category_limits where budget_id = v_budget_id;

  insert into public.budget_category_limits (user_id, budget_id, category_id, limit_minor)
  select v_uid, v_budget_id, (item ->> 'category_id')::uuid, (item ->> 'limit_minor')::bigint
    from jsonb_array_elements(coalesce(p_limits, '[]'::jsonb)) as item;

  return v_budget_id;
end;
$$;

revoke execute on function public.save_budget(date, bigint, bigint, jsonb) from public, anon;
grant  execute on function public.save_budget(date, bigint, bigint, jsonb) to authenticated;
