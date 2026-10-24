-- =============================================================================
-- RandRoute — 5: fix account deletion when the user has saved transactions
--
-- Deleting a user cascades through statement_imports, statement_sources and
-- transactions in one command. The transaction-count trigger was updating
-- statement_imports rows that the same command was about to delete or
-- set-null, and Postgres rejected the whole delete ("Database error deleting
-- user"). During a cascade the parent import is being removed anyway, so the
-- trigger now skips itself when it runs inside another trigger (a cascade).
-- =============================================================================

create or replace function public.sync_import_transaction_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- pg_trigger_depth() > 1 means this delete/insert came from a foreign-key
  -- cascade (or another trigger), not directly from the app.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

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
