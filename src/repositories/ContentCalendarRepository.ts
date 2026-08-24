import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand, ImagePlatform, Platform } from "@/lib/domain";

export interface CalendarEntry {
  id: string;
  calendarDate: string;
  brand: Brand;
  /** Platforms this day's post targets. */
  platforms: ImagePlatform[];
  prompt: string | null;
  brandPresetId: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface CalendarEntryRow {
  id: string;
  calendar_date: string;
  brand: Brand;
  platform: Platform | null;
  platforms: unknown;
  prompt: string | null;
  brand_preset_id: string | null;
  created_by: string | null;
  created_at: string;
}

const COLUMNS =
  "id, calendar_date, brand, platform, platforms, prompt, brand_preset_id, created_by, created_at";

/** Only code allowed to touch content_calendar. */
export class ContentCalendarRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: {
    calendarDate: string;
    brand: Brand;
    platforms: ImagePlatform[];
    prompt: string | null;
    brandPresetId: string | null;
    createdBy: string;
  }): Promise<CalendarEntry> {
    const { data, error } = await this.supabase
      .from("content_calendar")
      .insert({
        calendar_date: input.calendarDate,
        brand: input.brand,
        // Keep the legacy single column populated for back-compat.
        platform: input.platforms[0] ?? null,
        platforms: input.platforms,
        prompt: input.prompt,
        brand_preset_id: input.brandPresetId,
        created_by: input.createdBy,
      })
      .select(COLUMNS)
      .single<CalendarEntryRow>();
    if (error) throw new Error(`content_calendar insert failed: ${error.message}`);
    return toDomain(data);
  }

  async listBetween(fromDate: string, toDate: string): Promise<CalendarEntry[]> {
    const { data, error } = await this.supabase
      .from("content_calendar")
      .select(COLUMNS)
      .gte("calendar_date", fromDate)
      .lte("calendar_date", toDate)
      .order("calendar_date", { ascending: true })
      .returns<CalendarEntryRow[]>();
    if (error) throw new Error(`content_calendar query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async listForDate(calendarDate: string): Promise<CalendarEntry[]> {
    const { data, error } = await this.supabase
      .from("content_calendar")
      .select(COLUMNS)
      .eq("calendar_date", calendarDate)
      .returns<CalendarEntryRow[]>();
    if (error) throw new Error(`content_calendar query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from("content_calendar").delete().eq("id", id);
    if (error) throw new Error(`content_calendar delete failed: ${error.message}`);
  }
}

function toDomain(row: CalendarEntryRow): CalendarEntry {
  const platforms = Array.isArray(row.platforms) ? (row.platforms as ImagePlatform[]) : [];
  return {
    id: row.id,
    calendarDate: row.calendar_date,
    brand: row.brand,
    // Fall back to the legacy single-platform column for rows created before
    // multi-platform; default to instagram if neither is set.
    platforms:
      platforms.length > 0
        ? platforms
        : row.platform
          ? [row.platform as ImagePlatform]
          : ["instagram"],
    prompt: row.prompt,
    brandPresetId: row.brand_preset_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
