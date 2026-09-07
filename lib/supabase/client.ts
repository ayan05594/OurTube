"use client";

import { createBrowserClient } from "@supabase/ssr";

import { requireSupabaseConfig } from "./config";
import { SUPABASE_AUTH_COOKIE_OPTIONS } from "./cookies";
import type { Database } from "./database.types";

export function createClient() {
  const { url, anonKey } = requireSupabaseConfig();

  return createBrowserClient<Database>(url, anonKey, {
    isSingleton: true,
    cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
  });
}
