import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Supabase Realtime must be able to read the session in the browser, so these
 * cookies cannot be HttpOnly. Keep the remaining scope as narrow as possible
 * and require HTTPS transport in production.
 */
export const SUPABASE_AUTH_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  httpOnly: false,
} satisfies CookieOptionsWithName;
