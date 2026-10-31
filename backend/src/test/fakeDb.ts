import { vi } from "vitest";

/**
 * A tiny stand-in for the Supabase query builder. Every filter method is
 * accepted and ignored; awaiting a query resolves to the rows for that table.
 * Inserts, updates, deletes and rpc calls are recorded for assertions.
 */
export function fakeDb(tables: Record<string, unknown[]>, rpc: Record<string, unknown> = {}) {
  const writes: { table: string; op: string; value?: unknown }[] = [];

  function query(table: string) {
    let op = "select";
    let value: unknown;
    const result = () => {
      const rows = tables[table] ?? [];
      return { data: op === "select" ? rows : rows.slice(0, 1), error: null, count: rows.length };
    };
    const chain: Record<string, unknown> = {};
    const passthrough = ["select", "eq", "neq", "gte", "lte", "lt", "gt", "in", "is", "order", "range", "limit", "ilike", "or", "not", "contains"];
    for (const name of passthrough) chain[name] = () => chain;
    for (const name of ["insert", "update", "delete", "upsert"]) {
      chain[name] = (v?: unknown) => {
        op = name;
        value = v;
        writes.push({ table, op, value });
        return chain;
      };
    }
    // After an insert, return the inserted row (with an id) like PostgREST does.
    chain.maybeSingle = async () =>
      op === "insert" && value && !Array.isArray(value)
        ? { data: { id: `new-${table}`, ...(value as object) }, error: null }
        : { data: (tables[table] ?? [])[0] ?? null, error: null };
    chain.single = chain.maybeSingle;
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  }

  const db = {
    from: vi.fn((table: string) => query(table)),
    // An rpc entry can be a value, or a function returning { data, error } for error cases.
    rpc: vi.fn(async (name: string, args?: unknown) => {
      const entry = rpc[name];
      return typeof entry === "function" ? (entry as (a: unknown) => unknown)(args) : { data: entry ?? null, error: null };
    }),
  };
  return { db, writes };
}
