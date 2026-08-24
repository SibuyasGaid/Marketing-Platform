import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/tokenCrypto";

export interface SocialConnection {
  id: string;
  accountSlug: string;
  platform: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  externalId: string | null;
  externalName: string | null;
  meta: Record<string, unknown>;
}

interface SocialConnectionRow {
  id: string;
  account_slug: string;
  platform: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  external_id: string | null;
  external_name: string | null;
  meta: Record<string, unknown> | null;
}

const COLUMNS =
  "id, account_slug, platform, access_token, refresh_token, expires_at, external_id, external_name, meta";

/** Only code allowed to touch social_connections. Service-role only (no RLS
 * policies exist), so tokens never reach the browser. */
export class SocialConnectionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async get(accountSlug: string, platform: string): Promise<SocialConnection | null> {
    const { data, error } = await this.supabase
      .from("social_connections")
      .select(COLUMNS)
      .eq("account_slug", accountSlug)
      .eq("platform", platform)
      .maybeSingle<SocialConnectionRow>();
    if (error) throw new Error(`social_connections query failed: ${error.message}`);
    return data ? toDomain(data) : null;
  }

  /** Lightweight status for UI: which (account, platform) pairs are connected. */
  async listStatus(): Promise<Array<{ accountSlug: string; platform: string; externalName: string | null }>> {
    const { data, error } = await this.supabase
      .from("social_connections")
      .select("account_slug, platform, external_name")
      .returns<Array<{ account_slug: string; platform: string; external_name: string | null }>>();
    if (error) throw new Error(`social_connections query failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      accountSlug: row.account_slug,
      platform: row.platform,
      externalName: row.external_name,
    }));
  }

  async upsert(input: {
    accountSlug: string;
    platform: string;
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: string | null;
    externalId?: string | null;
    externalName?: string | null;
    meta?: Record<string, unknown>;
    connectedBy: string;
  }): Promise<void> {
    const { error } = await this.supabase.from("social_connections").upsert(
      {
        account_slug: input.accountSlug,
        platform: input.platform,
        access_token: encryptToken(input.accessToken),
        refresh_token: input.refreshToken ? encryptToken(input.refreshToken) : null,
        expires_at: input.expiresAt ?? null,
        external_id: input.externalId ?? null,
        external_name: input.externalName ?? null,
        meta: input.meta ?? {},
        connected_by: input.connectedBy,
      },
      { onConflict: "account_slug,platform" },
    );
    if (error) throw new Error(`social_connections upsert failed: ${error.message}`);
  }

  /**
   * Refreshes just the stored tokens (leaves connected_by / external ids as
   * they are). Used by publishers when an access token is renewed via a
   * refresh token, where there is no acting user.
   */
  async updateTokens(input: {
    accountSlug: string;
    platform: string;
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: string | null;
  }): Promise<void> {
    const patch: Record<string, unknown> = {
      access_token: encryptToken(input.accessToken),
      expires_at: input.expiresAt ?? null,
    };
    if (input.refreshToken !== undefined) {
      patch.refresh_token = input.refreshToken ? encryptToken(input.refreshToken) : null;
    }
    const { error } = await this.supabase
      .from("social_connections")
      .update(patch)
      .eq("account_slug", input.accountSlug)
      .eq("platform", input.platform);
    if (error) throw new Error(`social_connections token update failed: ${error.message}`);
  }

  async remove(accountSlug: string, platform: string): Promise<void> {
    const { error } = await this.supabase
      .from("social_connections")
      .delete()
      .eq("account_slug", accountSlug)
      .eq("platform", platform);
    if (error) throw new Error(`social_connections delete failed: ${error.message}`);
  }
}

function toDomain(row: SocialConnectionRow): SocialConnection {
  return {
    id: row.id,
    accountSlug: row.account_slug,
    platform: row.platform,
    accessToken: decryptToken(row.access_token),
    refreshToken: row.refresh_token ? decryptToken(row.refresh_token) : null,
    expiresAt: row.expires_at,
    externalId: row.external_id,
    externalName: row.external_name,
    meta: row.meta ?? {},
  };
}
