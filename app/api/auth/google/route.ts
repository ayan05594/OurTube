import { NextResponse, type NextRequest } from "next/server";

import {
  requireSiteOrigin,
  SiteOriginConfigurationError,
} from "@/lib/auth/origin";
import { pathWithQuery, safeRelativePath } from "@/lib/auth/redirects";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const next = safeRelativePath(
    request.nextUrl.searchParams.get("next"),
    "/connect",
  );

  try {
    const siteOrigin = requireSiteOrigin(request.nextUrl.origin);
    if (request.nextUrl.origin !== siteOrigin) {
      const canonicalStart = new URL("/api/auth/google", siteOrigin);
      canonicalStart.searchParams.set("next", next);
      return noStore(NextResponse.redirect(canonicalStart, 307));
    }

    const { supabase, applyTo } = createRouteClient(request);
    const callbackUrl = new URL("/auth/callback", siteOrigin);
    callbackUrl.searchParams.set("next", next);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl.href,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error || !data.url) {
      return applyTo(authFailure("oauth_start_failed", siteOrigin));
    }

    return applyTo(noStore(NextResponse.redirect(data.url, 302)));
  } catch (error) {
    return authFailure(
      error instanceof SupabaseConfigurationError
        ? "supabase_not_configured"
        : error instanceof SiteOriginConfigurationError
          ? "site_url_not_configured"
        : "oauth_start_failed",
    );
  }
}

function authFailure(code: string, siteOrigin?: string) {
  const pathname = pathWithQuery("/", { authError: code });
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
  return response;
}
