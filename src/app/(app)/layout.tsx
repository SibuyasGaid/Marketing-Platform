import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import type { ProviderAlertView } from "@/components/usage/ProviderAlertModal";
import { getUsageService } from "@/lib/container";
import { isDemoMode } from "@/lib/demoMode";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { JobRepository } from "@/repositories/JobRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // proxy.ts already gates this, but defense in depth costs one call.
  if (!user) redirect("/login");

  const profile = await new ProfileRepository(supabase).getById(user.id);

  // Ambient shell data — spend chip, outage alerts, and the nav "generation in
  // progress" counts. All four are independent, so fetch them in ONE parallel
  // batch (not sequential blocks) to shave a round-trip off every navigation.
  // Each degrades on its own: a failure shows $0.00 / no alerts / no badge
  // rather than crashing the shell.
  let usageTodayUsd = 0;
  let alerts: ProviderAlertView[] = [];
  let activeCounts = { images: 0, videos: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const usageService = getUsageService();
    const [usage, alertRows, images, videos] = await Promise.all([
      usageService.getTodayTotalUsd().catch(() => 0),
      usageService.getActiveAlerts().catch(() => []),
      new JobRepository(admin).countActiveImageJobs().catch(() => 0),
      new ContentItemRepository(admin).countRenderingStudioVideos().catch(() => 0),
    ]);
    usageTodayUsd = usage;
    alerts = alertRows;
    activeCounts = { images, videos };
  } catch {
    // Logged server-side by the platform; shell renders with safe defaults.
  }

  return (
    <AppShell
      profile={{
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
      }}
      usageTodayUsd={usageTodayUsd}
      alerts={alerts.map(({ id, provider, message }) => ({ id, provider, message }))}
      activeCounts={activeCounts}
      demoMode={isDemoMode()}
    >
      {children}
    </AppShell>
  );
}
