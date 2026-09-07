"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { pathWithQuery, safeRelativePath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";
import {
  YOUTUBE_ACCESS_COOKIE,
  YOUTUBE_OWNER_COOKIE,
  YOUTUBE_PENDING_COOKIE,
  youtubeAccessCookieOptions,
  youtubePendingCookieOptions,
} from "@/lib/youtube/auth";

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

  const cookieStore = await cookies();
  cookieStore.set(YOUTUBE_ACCESS_COOKIE, "", youtubeAccessCookieOptions(0));
  cookieStore.set(YOUTUBE_OWNER_COOKIE, "", youtubeAccessCookieOptions(0));
  cookieStore.set(YOUTUBE_PENDING_COOKIE, "", youtubePendingCookieOptions(0));

  if (failed) redirect(pathWithQuery(next, { authError: "signout_failed" }));
  revalidatePath("/", "layout");
  redirect(next);
}

function readString(value: FormDataEntryValue | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}
