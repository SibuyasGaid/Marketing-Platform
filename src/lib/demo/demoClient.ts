import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_USER_ID, demoRows } from "@/lib/demo/fixtures";
import { placeholderFor } from "@/lib/demo/placeholders";

/**
 * A stand-in for the Supabase client used when no database is configured.
 *
 * Interception happens here rather than in the repositories on purpose: the
 * repository layer is the only thing that touches the database, so replacing
 * the client underneath it leaves all 16 repositories, every service, and every
 * page completely untouched. Demo mode adds no branching to business logic.
 *
 * The builder implements the slice of PostgREST the repositories actually use:
 * the comparison filters, ordering, limiting, and count/single terminators.
 * That is enough for `getById` to return the row asked for and for status
 * filters to exclude what they should, so the demo behaves coherently when you
 * click into it. Operators outside that slice pass through without narrowing
 * rather than erroring, which keeps this file from growing into a half-correct
 * database.
 *
 * Writes never mutate. An insert or update resolves with the row it was handed
 * so a repository that chains `.select().single()` after a write still gets an
 * object back, but nothing persists and the next read is unchanged. Server
 * actions are short-circuited before they reach this point, so a write landing
 * here is a background path, not a user action.
 */

type Row = Record<string, unknown>;

interface Result {
  data: unknown;
  error: null;
  count: number | null;
  status: number;
  statusText: string;
}

function result(data: unknown, count: number | null = null): Result {
  return { data, error: null, count, status: 200, statusText: "OK" };
}

/** Comparison operators, each returning a row predicate. */
const COMPARATORS: Record<string, (column: string, value: unknown) => (row: Row) => boolean> = {
  eq: (column, value) => (row) => row[column] === value,
  neq: (column, value) => (row) => row[column] !== value,
  is: (column, value) => (row) => (row[column] ?? null) === value,
  gt: (column, value) => (row) => compare(row[column], value) > 0,
  gte: (column, value) => (row) => compare(row[column], value) >= 0,
  lt: (column, value) => (row) => compare(row[column], value) < 0,
  lte: (column, value) => (row) => compare(row[column], value) <= 0,
  in: (column, value) => (row) => Array.isArray(value) && value.includes(row[column]),
};

/** Dates arrive as ISO strings, which compare correctly lexicographically. */
function compare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

const SINGLE_METHODS = new Set(["single", "maybeSingle"]);
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

interface BuilderState {
  rows: Row[];
  single: boolean;
  written: unknown;
  headOnly: boolean;
}

function createQueryBuilder(table: string): unknown {
  const state: BuilderState = {
    rows: [...demoRows(table)],
    single: false,
    written: undefined,
    headOnly: false,
  };

  const resolve = (): Result => {
    if (state.written !== undefined) {
      const payload = state.written;
      const row = Array.isArray(payload) ? (payload[0] ?? {}) : payload;
      return result(state.single ? row : [row]);
    }
    if (state.headOnly) return result(null, state.rows.length);
    if (state.single) return result(state.rows[0] ?? null);
    return result(state.rows, state.rows.length);
  };

  const builder: Record<string | symbol, unknown> = {};
  const proxy: unknown = new Proxy(builder, {
    get(_target, prop) {
      // Awaiting the builder runs the query.
      if (prop === "then") {
        return (onFulfilled: (value: Result) => unknown) =>
          Promise.resolve(resolve()).then(onFulfilled);
      }
      if (prop === "catch" || prop === "finally") return () => proxy;
      if (typeof prop !== "string") return undefined;

      if (prop in COMPARATORS) {
        return (column: string, value: unknown) => {
          state.rows = state.rows.filter(COMPARATORS[prop](column, value));
          return proxy;
        };
      }
      if (SINGLE_METHODS.has(prop)) {
        return () => {
          state.single = true;
          return proxy;
        };
      }
      if (WRITE_METHODS.has(prop)) {
        return (payload?: unknown) => {
          state.written = payload ?? {};
          return proxy;
        };
      }
      if (prop === "select") {
        return (_columns?: string, options?: { head?: boolean }) => {
          if (options?.head) state.headOnly = true;
          return proxy;
        };
      }
      if (prop === "order") {
        return (column: string, options?: { ascending?: boolean }) => {
          const direction = options?.ascending === false ? -1 : 1;
          state.rows = [...state.rows].sort(
            (a, b) => compare(a[column], b[column]) * direction,
          );
          return proxy;
        };
      }
      if (prop === "limit") {
        return (count: number) => {
          state.rows = state.rows.slice(0, count);
          return proxy;
        };
      }
      if (prop === "range") {
        return (from: number, to: number) => {
          state.rows = state.rows.slice(from, to + 1);
          return proxy;
        };
      }
      // returns / or / not / like / throwOnError and friends: keep the chain
      // going without narrowing.
      return () => proxy;
    },
  });
  return proxy;
}

function createStorageBucket() {
  return {
    async createSignedUrl(path: string) {
      return { data: { signedUrl: placeholderFor(path) }, error: null };
    },
    async createSignedUrls(paths: string[]) {
      return {
        data: paths.map((path) => ({ path, signedUrl: placeholderFor(path), error: null })),
        error: null,
      };
    },
    async upload() {
      return { data: { path: "" }, error: null };
    },
    async download() {
      return { data: null, error: { message: "Storage is unavailable in demo mode" } };
    },
    async remove() {
      return { data: [], error: null };
    },
    async list() {
      return { data: [], error: null };
    },
    getPublicUrl(path: string) {
      return { data: { publicUrl: placeholderFor(path) } };
    },
  };
}

const DEMO_USER = {
  id: DEMO_USER_ID,
  email: "demo@example.com",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date(0).toISOString(),
};

/**
 * Typed as SupabaseClient so callers need no special-casing. The cast is the
 * one dishonest line in the file and is deliberate: this object implements the
 * slice of the client the repositories use, not the full surface.
 */
export function createDemoSupabaseClient(): SupabaseClient {
  const client = {
    from: (table: string) => createQueryBuilder(table),
    storage: { from: () => createStorageBucket() },
    auth: {
      async getUser() {
        return { data: { user: DEMO_USER }, error: null };
      },
      async getSession() {
        return { data: { session: { user: DEMO_USER } }, error: null };
      },
      async signInWithPassword() {
        return { data: { user: DEMO_USER, session: null }, error: null };
      },
      async signOut() {
        return { error: null };
      },
    },
    rpc: async () => result(null),
  };
  return client as unknown as SupabaseClient;
}
