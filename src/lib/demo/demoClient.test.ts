import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoSupabaseClient } from "@/lib/demo/demoClient";
import { DEMO_USER_ID } from "@/lib/demo/fixtures";
import { DemoModeError, isDemoMode } from "@/lib/demoMode";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

const SUPABASE_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of SUPABASE_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of SUPABASE_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("isDemoMode", () => {
  it("is on when Supabase is not configured", () => {
    expect(isDemoMode()).toBe(true);
  });

  it("is off once both Supabase vars are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    expect(isDemoMode()).toBe(false);
  });

  it("stays on when only one var is set, so a half-configured deploy cannot half-connect", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    expect(isDemoMode()).toBe(true);
  });

  it("treats blank values as unset", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "   ";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    expect(isDemoMode()).toBe(true);
  });
});

describe("demo client, through the real repositories", () => {
  it("serves a profile so the app shell renders", async () => {
    const profile = await new ProfileRepository(createDemoSupabaseClient()).getById(DEMO_USER_ID);
    expect(profile.role).toBe("admin");
    expect(profile.email).toBe("demo@example.com");
  });

  it("returns queue items mapped through the real domain mapper", async () => {
    const items = await new ContentItemRepository(createDemoSupabaseClient()).listForQueue(120);
    expect(items.length).toBeGreaterThan(0);
    // toDomain ran: snake_case columns became domain fields.
    expect(items[0]).toHaveProperty("targetPlatforms");
    expect(items[0].generationInputs).toHaveProperty("adjustmentNotes");
  });

  it("honours .neq, so drafts stay out of the approval queue", async () => {
    const repo = new ContentItemRepository(createDemoSupabaseClient());
    const queue = await repo.listForQueue(120);
    expect(queue.some((item) => item.status === "draft")).toBe(false);
    // The draft exists — it is filtered, not missing from the fixtures.
    const all = await repo.listAll(120);
    expect(all.some((item) => item.status === "draft")).toBe(true);
  });

  it("honours .eq, so getById returns the row asked for rather than the first one", async () => {
    const repo = new ContentItemRepository(createDemoSupabaseClient());
    const all = await repo.listAll(120);
    const target = all[2];
    const fetched = await repo.getById(target.id);
    expect(fetched.id).toBe(target.id);
    expect(fetched.title).toBe(target.title);
  });

  it("orders by the requested column and direction", async () => {
    const items = await new ContentItemRepository(createDemoSupabaseClient()).listForQueue(120);
    const timestamps = items.map((item) => item.createdAt);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);
  });

  it("applies .limit", async () => {
    const items = await new ContentItemRepository(createDemoSupabaseClient()).listForQueue(2);
    expect(items).toHaveLength(2);
  });

  it("never persists a write — the next read is unchanged", async () => {
    const client = createDemoSupabaseClient();
    const repo = new ContentItemRepository(client);
    const before = await repo.listAll(120);
    await repo.setStatus(before[0].id, "posted");
    const after = await new ContentItemRepository(createDemoSupabaseClient()).listAll(120);
    expect(after.map((item) => item.status)).toEqual(before.map((item) => item.status));
  });

  it("resolves storage paths to self-contained placeholder art", async () => {
    const client = createDemoSupabaseClient();
    const { data } = await client.storage
      .from("generated-media")
      .createSignedUrl("generated/demo-launch.png", 60);
    expect(data?.signedUrl.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("reports a signed-in demo user so pages do not redirect to login", async () => {
    const {
      data: { user },
    } = await createDemoSupabaseClient().auth.getUser();
    expect(user?.id).toBe(DEMO_USER_ID);
  });

  it("returns an empty set for tables with no fixtures instead of throwing", async () => {
    const client = createDemoSupabaseClient();
    const { data, error } = await client.from("competitor_reports").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("DemoModeError", () => {
  it("carries the user-facing message that server actions surface", () => {
    const error = new DemoModeError();
    expect(error.message).toContain("nothing is saved");
    // Extends AppError, which is how each action's toState renders it verbatim.
    expect(error.code).toBe("auth_error");
  });
});
