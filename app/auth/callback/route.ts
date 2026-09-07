import { NextResponse, type NextRequest } from "next/server";

import { requireSiteOrigin } from "@/lib/auth/origin";
import { pathWithQuery, safeRelativePath } from "@/lib/auth/redirects";
import { createRouteClient } from "@/lib/supabase/route";
import {
  createYouTubeOwnerBinding,
  YOUTUBE_ACCESS_COOKIE,
  YOUTUBE_OWNER_COOKIE,
  YOUTUBE_PENDING_COOKIE,
  youtubeAccessCookieOptions,
  youtubePendingCookieOptions,
} from "@/lib/youtube/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRelativePath(
    request.nextUrl.searchParams.get("next"),
    "/connect",
  );
  const youtubeFlow = hasSingleYouTubeMarker(request.nextUrl.searchParams);

  let siteOrigin: string | undefined;

  try {
    siteOrigin = requireSiteOrigin(request.nextUrl.origin);
    if (!code || code.length > 4096) {
      return youtubeFlow
        ? youtubeCallbackFailure(next, siteOrigin, "youtube_oauth_failed")
        : callbackFailure(siteOrigin);
    }
    if (request.nextUrl.origin !== siteOrigin) {
      const canonicalCallback = new URL("/auth/callback", siteOrigin);
      canonicalCallback.searchParams.set("code", code);
      canonicalCallback.searchParams.set("next", next);
      if (youtubeFlow) canonicalCallback.searchParams.set("youtube", "1");
      return noStore(NextResponse.redirect(canonicalCallback, 307));
    }

    const { supabase, applyTo } = createRouteClient(request);
    const pendingUserId = request.cookies.get(YOUTUBE_PENDING_COOKIE)?.value;
    const { data: beforeExchange, error: currentUserError } = youtubeFlow
      ? await supabase.auth.getUser()
      : { data: { user: null }, error: null };

    if (
      youtubeFlow &&
      (currentUserError ||
        !beforeExchange.user ||
        !pendingUserId ||
        pendingUserId !== beforeExchange.user.id)
    ) {
      return youtubeCallbackFailure(next, siteOrigin, "youtube_oauth_expired");
    }

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return applyTo(
        youtubeFlow
          ? youtubeCallbackFailure(next, siteOrigin, "youtube_oauth_failed")
          : callbackFailure(siteOrigin),
      );
    }

    if (youtubeFlow) {
      const providerToken = data.session?.provider_token;
      if (
        !data.user ||
        data.user.id !== beforeExchange.user?.id ||
        !isProviderToken(providerToken)
      ) {
        return youtubeCallbackFailure(
          next,
          siteOrigin,
          data.user && data.user.id !== beforeExchange.user?.id
            ? "youtube_account_mismatch"
            : "youtube_oauth_failed",
        );
      }

      const response = noStore(
        NextResponse.redirect(new URL(next, siteOrigin), 302),
      );
      const ownerBinding = await createYouTubeOwnerBinding(
        data.user.id,
        providerToken,
      );
      response.cookies.set(
        YOUTUBE_ACCESS_COOKIE,
        providerToken,
        youtubeAccessCookieOptions(),
      );
      response.cookies.set(
        YOUTUBE_OWNER_COOKIE,
        ownerBinding,
        youtubeAccessCookieOptions(),
      );
      response.cookies.set(
        YOUTUBE_PENDING_COOKIE,
        "",
        youtubePendingCookieOptions(0),
      );
      return applyTo(response);
    }

    const response = noStore(
      NextResponse.redirect(new URL(next, siteOrigin), 302),
    );
    clearYouTubeCookies(response);
    return applyTo(response);
  } catch {
    return youtubeFlow && siteOrigin
      ? youtubeCallbackFailure(next, siteOrigin, "youtube_oauth_failed")
      : callbackFailure(siteOrigin);
  }
}

function youtubeCallbackFailure(
  next: string,
  siteOrigin: string,
  code: string,
) {
  const response = noStore(
    NextResponse.redirect(
      new URL(pathWithQuery(next, { youtubeError: code }), siteOrigin),
      302,
    ),
  );
  response.cookies.set(
    YOUTUBE_PENDING_COOKIE,
    "",
    youtubePendingCookieOptions(0),
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
  return response;
}

function clearYouTubeCookies(response: NextResponse): void {
  response.cookies.set(YOUTUBE_ACCESS_COOKIE, "", youtubeAccessCookieOptions(0));
  response.cookies.set(YOUTUBE_OWNER_COOKIE, "", youtubeAccessCookieOptions(0));
  response.cookies.set(
    YOUTUBE_PENDING_COOKIE,
    "",
    youtubePendingCookieOptions(0),
  );
}

function hasSingleYouTubeMarker(searchParams: URLSearchParams): boolean {
  const markers = searchParams.getAll("youtube");
  return markers.length === 1 && markers[0] === "1";
}

function isProviderToken(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      value.length >= 20 &&
      value.length <= 4_096 &&
      !/[\u0000-\u0020\u007f]/u.test(value),
  );
}

function callbackFailure(siteOrigin?: string) {
  const pathname = pathWithQuery("/", { authError: "oauth_callback_failed" });
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
