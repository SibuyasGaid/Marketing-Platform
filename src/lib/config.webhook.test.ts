import { describe, expect, it } from "vitest";
import { n8nWebhookUrlForPlatform, type ServerEnv } from "@/lib/config";

const env = {
  N8N_WEBHOOK_URL_INSTAGRAM: "https://n8n.example.com/ig",
  N8N_WEBHOOK_URL_FACEBOOK: "https://n8n.example.com/fb",
  N8N_WEBHOOK_URL_LINKEDIN: "https://n8n.example.com/li",
  N8N_WEBHOOK_URL_YOUTUBE: "https://n8n.example.com/yt",
} as unknown as ServerEnv;

describe("n8nWebhookUrlForPlatform", () => {
  it("routes each platform to its own webhook", () => {
    expect(n8nWebhookUrlForPlatform(env, "instagram")).toBe("https://n8n.example.com/ig");
    expect(n8nWebhookUrlForPlatform(env, "facebook")).toBe("https://n8n.example.com/fb");
    expect(n8nWebhookUrlForPlatform(env, "linkedin")).toBe("https://n8n.example.com/li");
    expect(n8nWebhookUrlForPlatform(env, "youtube")).toBe("https://n8n.example.com/yt");
  });

  it("returns undefined for a platform whose webhook isn't configured", () => {
    const partial = { N8N_WEBHOOK_URL_INSTAGRAM: "https://n8n.example.com/ig" } as unknown as ServerEnv;
    expect(n8nWebhookUrlForPlatform(partial, "instagram")).toBe("https://n8n.example.com/ig");
    expect(n8nWebhookUrlForPlatform(partial, "linkedin")).toBeUndefined();
  });
});
