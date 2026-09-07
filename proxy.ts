import { NextResponse, type NextRequest } from "next/server";

import { getSiteOrigin } from "@/lib/auth/origin";
import { safeRelativePath } from "@/lib/auth/redirects";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const recovery = recoverRootOAuthCode(request);
  if (recovery) return recovery;

  return updateSession(request);
}

function recoverRootOAuthCode(request: NextRequest): NextResponse | null {
  if (request.method !== "GET" || request.nextUrl.pathname !== "/") {
    return null;
  }

  const codes = request.nextUrl.searchParams.getAll("code");
  if (codes.length === 0) return null;

  const siteOrigin = getSiteOrigin(request.nextUrl.origin);
  if (!siteOrigin) return null;

  const [code] = codes;
  if (codes.length !== 1 || !code || code.length > 4096) {
    const failure = new URL("/", siteOrigin);
    failure.searchParams.set("authError", "oauth_callback_failed");
    return noStoreRedirect(failure, 302);
  }

  const callback = new URL("/auth/callback", siteOrigin);
  callback.searchParams.set("code", code);
  callback.searchParams.set(
    "next",
    safeRelativePath(request.nextUrl.searchParams.get("next"), "/connect"),
  );
  return noStoreRedirect(callback, 307);
}

function noStoreRedirect(url: URL, status: 302 | 307) {
  const response = NextResponse.redirect(url, status);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
