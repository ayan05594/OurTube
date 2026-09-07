import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { requireSupabaseConfig } from "./config";
import { SUPABASE_AUTH_COOKIE_OPTIONS } from "./cookies";
import type { Database } from "./database.types";

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

/** Attach refreshed cookies and anti-cache headers to a route response. */
export function createRouteClient(request: NextRequest) {
  const { url, anonKey } = requireSupabaseConfig();
  const pendingCookies = new Map<string, PendingCookie>();
  const pendingHeaders = new Headers();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach((cookie) => {
          pendingCookies.set(cookie.name, cookie);
        });
        Object.entries(headersToSet).forEach(([name, value]) => {
          pendingHeaders.set(name, value);
        });
      },
    },
  });

  function applyTo<T extends NextResponse>(response: T): T {
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    pendingHeaders.forEach((value, name) => {
      response.headers.set(name, value);
    });
    return response;
  }

  return { supabase, applyTo } as const;
}
