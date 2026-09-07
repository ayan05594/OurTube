"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { pathWithQuery, safeRelativePath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export async function signInWithGoogle(formData?: FormData): Promise<never> {
  const next = safeRelativePath(readString(formData?.get("next")), "/connect");
  redirect(pathWithQuery("/api/auth/google", { next }));
}

export async function signOut(formData?: FormData): Promise<never> {
  const next = safeRelativePath(readString(formData?.get("next")), "/");
  let failed = false;

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims) {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
    }
  } catch {
    failed = true;
  }

  if (failed) redirect(pathWithQuery(next, { authError: "signout_failed" }));
  revalidatePath("/", "layout");
  redirect(next);
}

function readString(value: FormDataEntryValue | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}
