import { AccountsList, type AccountListItem } from "@/components/accounts/AccountsList";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AccountRepository, fallbackAccounts } from "@/repositories/AccountRepository";
import { BrandReferenceRepository } from "@/repositories/BrandReferenceRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

export const metadata = { title: "Accounts · Content Studio" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await new ProfileRepository(supabase).getById(user.id) : null;

  const admin = createSupabaseAdminClient();
  const accountList = await new AccountRepository(admin).listActive().catch(() => fallbackAccounts());
  const accounts = accountList.length > 0 ? accountList : fallbackAccounts();
  const refRepo = new BrandReferenceRepository(admin);

  const items: AccountListItem[] = await Promise.all(
    accounts.map(async (account) => ({
      slug: account.slug,
      name: account.name,
      description: account.description,
      referenceCount: (await refRepo.listForAccount(account.slug).catch(() => [])).length,
    })),
  );

  return <AccountsList accounts={items} canManage={profile?.role !== "reviewer"} />;
}
