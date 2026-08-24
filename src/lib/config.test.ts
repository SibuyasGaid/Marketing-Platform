import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getServerEnv, resetServerEnvCache } from "@/lib/config";

const VALID_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  ANTHROPIC_API_KEY: "anthropic-key",
  GOOGLE_GEMINI_API_KEY: "gemini-key",
  HEYGEN_API_KEY: "heygen-key",
  RESEND_API_KEY: "resend-key",
  INNGEST_EVENT_KEY: "event-key",
  INNGEST_SIGNING_KEY: "signing-key",
  N8N_WEBHOOK_SECRET: "hmac-secret",
};

const MANAGED_KEYS = [
  ...Object.keys(VALID_ENV),
  "SENDGRID_API_KEY",
  "OPENAI_API_KEY",
  "N8N_WEBHOOK_URL_INSTAGRAM",
  "N8N_WEBHOOK_URL_FACEBOOK",
  "N8N_WEBHOOK_URL_LINKEDIN",
  "N8N_WEBHOOK_URL_YOUTUBE",
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]]));
  for (const key of MANAGED_KEYS) delete process.env[key];
  resetServerEnvCache();
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  resetServerEnvCache();
});

function applyEnv(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
}

describe("getServerEnv", () => {
  it("parses a fully-populated environment", () => {
    applyEnv(VALID_ENV);
    const env = getServerEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(VALID_ENV.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("fails fast naming the missing variable — never its value", () => {
    const { ANTHROPIC_API_KEY: _omitted, ...rest } = VALID_ENV;
    applyEnv(rest);
    expect(() => getServerEnv()).toThrowError(/ANTHROPIC_API_KEY/);
    expect(() => getServerEnv()).not.toThrowError(new RegExp(VALID_ENV.RESEND_API_KEY));
  });

  it("boots without any email provider key (send fails later, boot does not)", () => {
    const { RESEND_API_KEY: _omitted, ...rest } = VALID_ENV;
    applyEnv(rest);
    expect(getServerEnv().RESEND_API_KEY).toBeUndefined();
  });

  it("accepts SendGrid as the email provider instead of Resend", () => {
    const { RESEND_API_KEY: _omitted, ...rest } = VALID_ENV;
    applyEnv({ ...rest, SENDGRID_API_KEY: "sendgrid-key" });
    expect(getServerEnv().SENDGRID_API_KEY).toBe("sendgrid-key");
  });

  it("rejects malformed webhook URLs but allows them to be absent", () => {
    applyEnv({ ...VALID_ENV, N8N_WEBHOOK_URL_INSTAGRAM: "not-a-url" });
    expect(() => getServerEnv()).toThrowError(/N8N_WEBHOOK_URL_INSTAGRAM/);
    resetServerEnvCache();
    delete process.env.N8N_WEBHOOK_URL_INSTAGRAM;
    applyEnv(VALID_ENV); // none of the four set → still boots
    expect(getServerEnv().N8N_WEBHOOK_URL_INSTAGRAM).toBeUndefined();
  });
});
