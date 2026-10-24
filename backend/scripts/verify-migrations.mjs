// Applies supabase/migrations to an in-memory Postgres (PGlite) with a stand-in
// for Supabase auth, then checks RLS, import confirmation, and deletion rules.
// Run: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import path from "node:path";

const migDir = process.argv[2] ?? path.resolve(import.meta.dirname, "../../supabase/migrations");
const db = new PGlite({ extensions: { pg_trgm } });

// Minimal stand-in for Supabase's auth schema, roles and default grants.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; grant usage on schema extensions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

for (const f of fs.readdirSync(migDir).sort()) {
  await db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
  console.log("applied", f);
}
// Seed twice to prove it is idempotent
await db.exec(fs.readFileSync(path.join(migDir, fs.readdirSync(migDir).find((f) => f.includes("seed_categories"))), "utf8"));

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${A}','a@x.co','{"display_name":"Hadi"}'), ('${B}','b@x.co','{}');`);

let failures = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const as = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { const results = await db.exec(sql); return results.at(-1); } finally { await db.exec("reset role;"); }
};
const fails = async (uid, sql, re) => {
  try { await as(uid, sql); return false; } catch (e) { return re ? re.test(e.message) : true; }
};

const one = async (uid, sql) => (await as(uid, sql)).rows[0];

check("seed: 24 system categories", ((await db.query("select count(*)::int n from public.categories where user_id is null")).rows[0].n === 24));
check("signup trigger creates preferences with display name",
  (await db.query(`select display_name, currency from public.user_preferences where user_id='${A}'`)).rows[0]?.display_name === "Hadi");

check("anon cannot read categories", await fails(null, "select * from public.categories"));
check("user sees system categories", (await one(A, "select count(*)::int n from public.categories")).n === 24);
check("user cannot edit system category", (await as(A, "update public.categories set name='x' where key='groceries' returning id")).rows.length === 0);

// A creates an import with staged rows
const imp = (await one(A, `insert into public.statement_imports (bank_format_key, period_start, period_end)
  values ('fnb_cheque','2026-09-01','2026-09-30') returning id`)).id;
const groceries = (await one(A, "select id from public.categories where key='groceries'")).id;
await as(A, `insert into public.staged_transactions (import_id,row_index,transaction_date,cleaned_description,amount_minor,direction,category_id,transaction_type)
  values ('${imp}',0,'2026-09-02','Checkers',45000,'outflow','${groceries}','expense'),
         ('${imp}',1,'2026-09-25','Salary',2500000,'inflow',null,'income'),
         ('${imp}',2,'2026-09-03','Excluded row',100,'outflow',null,'unknown');
  update public.staged_transactions set include=false where row_index=2;`);

check("B cannot see A's import", (await as(B, "select * from public.statement_imports")).rows.length === 0);
check("B cannot see A's staged rows", (await as(B, "select * from public.staged_transactions")).rows.length === 0);
check("B cannot attach a staged row to A's import",
  await fails(B, `insert into public.staged_transactions (import_id,row_index,transaction_date,cleaned_description,amount_minor,direction)
    values ('${imp}',9,'2026-09-02','x',1,'outflow')`));
check("B cannot confirm A's import", await fails(B, `select public.confirm_import('${imp}')`, /not found/i));
check("float/zero amount rejected", await fails(A, `insert into public.staged_transactions (import_id,row_index,transaction_date,cleaned_description,amount_minor,direction)
    values ('${imp}',8,'2026-09-02','x',0,'outflow')`));

const saved = (await one(A, `select public.confirm_import('${imp}') n`)).n;
check("confirm saves 2 included rows", saved === 2);
const after = await one(A, `select status, transaction_count, imported_at is not null done from public.statement_imports where id='${imp}'`);
check("import marked imported with count 2", after.status === "imported" && after.transaction_count === 2 && after.done);
check("staged rows cleared", (await one(A, "select count(*)::int n from public.staged_transactions")).n === 0);
check("confirm twice is refused", await fails(A, `select public.confirm_import('${imp}')`, /not waiting/i));

// Duplicate flow on a second import
const imp2 = (await one(A, `insert into public.statement_imports (bank_format_key, period_start, period_end, validation_summary)
  values ('fnb_cheque','2026-09-15','2026-10-14','{"has_warnings":true}') returning id`)).id;
const existing = (await one(A, "select id from public.transactions where cleaned_description='Checkers'")).id;
await as(A, `insert into public.staged_transactions (import_id,row_index,transaction_date,cleaned_description,amount_minor,direction,duplicate_of_transaction_id,duplicate_decision)
  values ('${imp2}',0,'2026-09-02','Checkers',45000,'outflow','${existing}','unresolved'),
         ('${imp2}',1,'2026-10-01','Uber',8000,'outflow',null,null)`);
check("unresolved duplicate blocks confirm", await fails(A, `select public.confirm_import('${imp2}')`, /duplicate/i));
check("duplicate without decision rejected", await fails(A, `insert into public.staged_transactions (import_id,row_index,transaction_date,cleaned_description,amount_minor,direction,duplicate_of_transaction_id)
  values ('${imp2}',5,'2026-09-02','x',1,'outflow','${existing}')`));
await as(A, `update public.staged_transactions set duplicate_decision='exclude' where row_index=0 and import_id='${imp2}'`);
check("excluded duplicate is skipped", (await one(A, `select public.confirm_import('${imp2}') n`)).n === 1);
check("warnings -> status partial", (await one(A, `select status from public.statement_imports where id='${imp2}'`)).status === "partial");

// Edits and deletes
check("B cannot update A's transaction", (await as(B, `update public.transactions set amount_minor=1 returning id`)).rows.length === 0);
await as(A, `delete from public.transactions where cleaned_description='Salary'`);
check("deleting a transaction lowers import count", (await one(A, `select transaction_count n from public.statement_imports where id='${imp}'`)).n === 1);

// Cancel
const imp3 = (await one(A, `insert into public.statement_imports (bank_format_key, period_start, period_end) values ('capitec','2026-10-01','2026-10-31') returning id`)).id;
await as(A, `insert into public.staged_transactions (import_id,row_index,transaction_date,cleaned_description,amount_minor,direction) values ('${imp3}',0,'2026-10-02','x',10,'outflow')`);
await as(A, `select public.cancel_import('${imp3}')`);
check("cancel marks cancelled and clears staging",
  (await one(A, `select status from public.statement_imports where id='${imp3}'`)).status === "cancelled" &&
  (await one(A, "select count(*)::int n from public.staged_transactions")).n === 0);
check("bad period rejected", await fails(A, `insert into public.statement_imports (bank_format_key, period_start, period_end) values ('x','2026-10-31','2026-10-01')`));

// Budgets
const bud = (await one(A, `insert into public.monthly_budgets (month) values ('2026-09-01') returning id`)).id;
await as(A, `insert into public.budget_category_limits (budget_id, category_id, limit_minor) values ('${bud}','${groceries}',300000)`);
check("budget month must be first of month", await fails(A, `insert into public.monthly_budgets (month) values ('2026-09-15')`));
check("B cannot add a limit to A's budget", await fails(B, `insert into public.budget_category_limits (budget_id, category_id, limit_minor) values ('${bud}','${groceries}',1)`));
const bCat = (await one(B, `insert into public.categories (user_id,key,name) values ('${B}','b_only','B only') returning id`)).id;
check("A cannot use B's private category", await fails(A, `update public.transactions set category_id='${bCat}'`));

// AI log
await as(A, `insert into public.ai_requests (kind,status) values ('ask','ok')`);
check("user cannot delete own AI log rows", (await as(A, `delete from public.ai_requests returning id`)).rows.length === 0);
check("user cannot run cleanup_stale_imports", await fails(A, "select public.cleanup_stale_imports()", /permission/i));

// Delete all + account deletion
await as(A, "select public.delete_all_financial_records()");
const left = await db.query(`select (select count(*) from public.transactions where user_id='${A}')::int t,
  (select count(*) from public.statement_imports where user_id='${A}')::int i,
  (select count(*) from public.monthly_budgets where user_id='${A}')::int b,
  (select count(*) from public.user_preferences where user_id='${A}')::int p`);
check("delete_all removes financial data but keeps preferences", JSON.stringify(left.rows[0]) === '{"t":0,"i":0,"b":0,"p":1}');
await db.exec(`delete from auth.users where id='${B}'`);
check("deleting auth user cascades everything",
  (await db.query(`select count(*)::int n from public.categories where user_id='${B}'`)).rows[0].n === 0 &&
  (await db.query(`select count(*)::int n from public.user_preferences where user_id='${B}'`)).rows[0].n === 0);

// Account deletion with saved transactions (cascades through imports + transactions)
const C = "33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users (id, email) values ('${C}', 'c@x.co')`);
const impC = (await one(C, `insert into public.statement_imports (bank_format_key, period_start, period_end) values ('fnb','2026-09-01','2026-09-30') returning id`)).id;
await as(C, `insert into public.staged_transactions (import_id,row_index,transaction_date,cleaned_description,amount_minor,direction) values ('${impC}',0,'2026-09-02','x',10,'outflow'),('${impC}',1,'2026-09-03','y',20,'outflow')`);
await as(C, `select public.confirm_import('${impC}')`);
let deleteError = null;
try { await db.exec(`delete from auth.users where id='${C}'`); } catch (e) { deleteError = e.message; }
check("deleting an account with saved transactions works" + (deleteError ? " (" + deleteError + ")" : ""), deleteError === null &&
  (await db.query(`select count(*)::int n from public.transactions where user_id='${C}'`)).rows[0].n === 0);

console.log(failures ? `\n${failures} FAILED` : "\nAll SQL checks passed");
process.exit(failures ? 1 : 0);
