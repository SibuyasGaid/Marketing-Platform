"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { DEMO_MESSAGE, isDemoMode } from "@/lib/demoMode";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export interface LoginFormState {
  error: string | null;
}

export async function signIn(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  if (isDemoMode()) return { error: DEMO_MESSAGE };

  const parsed = CredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Generic message — never surface vendor internals (docs/CODING_STANDARDS.md §4).
    return { error: "Invalid credentials." };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  // No session to end in demo mode; land back on the entry page.
  if (isDemoMode()) redirect("/login");

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
