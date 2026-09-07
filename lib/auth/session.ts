import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import { UnauthenticatedError } from "./errors";
import { pathWithQuery, safeRelativePath } from "./redirects";
import type { AuthenticatedUser } from "./types";

export type AuthenticatedContext = Readonly<{
  supabase: SupabaseClient<Database>;
  user: AuthenticatedUser;
}>;

/** Returns a freshly verified user, never the unverified user from getSession. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !isGoogleUser(data.user)) return null;
  return toAuthenticatedUser(data.user);
}

export async function requireCurrentUser(
  returnTo = "/",
): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (user) return user;

  redirect(
    pathWithQuery("/api/auth/google", {
      next: safeRelativePath(returnTo),
    }),
  );
}

/** For server operations that must return a structured 401 rather than redirect. */
export async function requireAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new UnauthenticatedError();
  if (!isGoogleUser(data.user)) {
    throw new UnauthenticatedError("google_required");
  }

  return {
    supabase,
    user: toAuthenticatedUser(data.user),
  };
}

function isGoogleUser(user: User): boolean {
  const metadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  if (metadata.provider === "google") return true;
  return (
    Array.isArray(metadata.providers) &&
    metadata.providers.some((provider) => provider === "google")
  );
}

function toAuthenticatedUser(user: User): AuthenticatedUser {
  const metadata = isRecord(user.user_metadata) ? user.user_metadata : {};
  const email = user.email ?? null;
  const name =
    firstNonEmptyString(metadata.full_name, metadata.name) ??
    email?.split("@")[0] ??
    "You";
  const avatarUrl = safeImageUrl(
    firstNonEmptyString(metadata.avatar_url, metadata.picture),
  );

  return { id: user.id, email, name, avatarUrl };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function safeImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
