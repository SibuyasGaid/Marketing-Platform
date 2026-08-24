import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, Role } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";

interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
}

/** Only code allowed to query the profiles table. Returns domain types, not raw rows. */
export class ProfileRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getById(id: string): Promise<Profile> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("id, email, display_name, role")
      .eq("id", id)
      .maybeSingle<ProfileRow>();

    if (error) throw new Error(`profiles query failed: ${error.message}`);
    if (!data) throw new NotFoundError("Profile", id);
    return this.toDomain(data);
  }

  /** Digest recipients: all admins (service-role client required). */
  async listAdmins(): Promise<Profile[]> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("id, email, display_name, role")
      .eq("role", "admin")
      .returns<ProfileRow[]>();
    if (error) throw new Error(`profiles query failed: ${error.message}`);
    return (data ?? []).map((row) => this.toDomain(row));
  }

  private toDomain(row: ProfileRow): Profile {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    };
  }
}
