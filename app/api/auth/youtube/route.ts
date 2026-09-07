import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

import {
  requireSiteOrigin,
  SiteOriginConfigurationError,
} from "@/lib/auth/origin";
import { pathWithQuery, safeRelativePath } from "@/lib/auth/redirects";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createRouteClient } from "@/lib/supabase/route";
import {
  YOUTUBE_ACCESS_COOKIE,
  YOUTUBE_OWNER_COOKIE,
  YOUTUBE_PENDING_COOKIE,
  youtubeAccessCookieOptions,
  youtubePendingCookieOptions,
} from "@/lib/youtube/auth";

export const dynamic = "force-dynamic";

const YOUTUBE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/youtube.readonly";

export async function GET(request: NextRequest) {
  const next = safeRelativePath(
    request.nextUrl.searchParams.get("next"),
    "/our-space",
  );

  try {
    const siteOrigin = requireSiteOrigin(request.nextUrl.origin);
    if (request.nextUrl.origin !== siteOrigin) {
      const canonicalStart = new URL("/api/auth/youtube", siteOrigin);
      canonicalStart.searchParams.set("next", next);
      return noStore(NextResponse.redirect(canonicalStart, 307));
    }

    const { supabase, applyTo } = createRouteClient(request);
    const { data: current, error: userError } = await supabase.auth.getUser();
    if (userError || !current.user?.email || !isGoogleUser(current.user)) {
      const regularSignIn = new URL("/api/auth/google", siteOrigin);
      regularSignIn.searchParams.set("next", next);
      return applyTo(noStore(NextResponse.redirect(regularSignIn, 302)));
    }

    const callbackUrl = new URL("/auth/callback", siteOrigin);
    callbackUrl.searchParams.set("next", next);
    callbackUrl.searchParams.set("youtube", "1");

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl.href,
        scopes: YOUTUBE_READONLY_SCOPE,
        queryParams: {
          access_type: "online",
          include_granted_scopes: "true",
          login_hint: current.user.email,
          prompt: "consent",
        },
      },
    });

    if (error || !data.url) {
      return applyTo(
        youtubeFailure(next, "youtube_oauth_start_failed", siteOrigin),
      );
    }

    const response = noStore(NextResponse.redirect(data.url, 302));
    response.cookies.set(
      YOUTUBE_PENDING_COOKIE,
      current.user.id,
      youtubePendingCookieOptions(),
    );
    response.cookies.set(
      YOUTUBE_ACCESS_COOKIE,
      "",
      youtubeAccessCookieOptions(0),
    );
    response.cookies.set(
      YOUTUBE_OWNER_COOKIE,
      "",
      youtubeAccessCookieOptions(0),
    );
    return applyTo(response);
  } catch (error) {
    return youtubeFailure(
      next,
      error instanceof SupabaseConfigurationError
        ? "supabase_not_configured"
        : error instanceof SiteOriginConfigurationError
          ? "site_url_not_configured"
          : "youtube_oauth_start_failed",
    );
  }
}

function isGoogleUser(user: User): boolean {
  const provider = user.app_metadata?.provider;
  const providers = user.app_metadata?.providers;
  return (
    provider === "google" ||
    (Array.isArray(providers) && providers.includes("google"))
  );
}

function youtubeFailure(next: string, code: string, siteOrigin?: string) {
  const pathname = pathWithQuery(next, { youtubeError: code });
  return noStore(
    siteOrigin
      ? NextResponse.redirect(new URL(pathname, siteOrigin), 302)
      : new NextResponse(null, {
          status: 302,
          headers: { Location: pathname },
        }),
  );
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
