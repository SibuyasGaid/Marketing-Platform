"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUsageService } from "@/lib/container";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileRepository } from "@/repositories/ProfileRepository";

const ResolveAlertSchema = z.object({ alertId: z.uuid() });

/** Admin-only: clears a provider credit alert after the account is topped up. */
export async function resolveProviderAlert(formData: FormData): Promise<void> {
  const { alertId } = ResolveAlertSchema.parse({ alertId: formData.get("alertId") });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const profile = await new ProfileRepository(supabase).getById(user.id);
  if (profile.role !== "admin") return;

  await getUsageService().resolveAlert(alertId);
  revalidatePath("/admin");
  revalidatePath("/", "layout");
}
