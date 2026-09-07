import { NextResponse, type NextRequest } from "next/server";

import { fetchCurrentConnection } from "@/lib/connections/rpc";
import { createRouteClient } from "@/lib/supabase/route";
import {
  createYouTubeOwnerBinding,
  YOUTUBE_ACCESS_COOKIE,
  YOUTUBE_OWNER_COOKIE,
  youtubeAccessCookieOptions,
} from "@/lib/youtube/auth";
import {
  discoverYouTubeVideos,
  YouTubeApiError,
  type YouTubeKind,
  type YouTubeResult,
} from "@/lib/youtube/client";

export const dynamic = "force-dynamic";

type ErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "NOT_CONNECTED"
  | "YOUTUBE_AUTH_REQUIRED"
  | "YOUTUBE_ACCESS_DENIED"
  | "YOUTUBE_RATE_LIMITED"
  | "YOUTUBE_UNAVAILABLE";

export async function GET(request: NextRequest) {
  const parsed = parseRequest(request.nextUrl.searchParams);
  if (!parsed.ok) return jsonError("INVALID_REQUEST", parsed.message, 400);

  let applyTo: ReturnType<typeof createRouteClient>["applyTo"] | undefined;

  try {
    const routeClient = createRouteClient(request);
    applyTo = routeClient.applyTo;
    const { data, error } = await routeClient.supabase.auth.getUser();
    if (error || !data.user) {
      return applyTo(
        jsonError("AUTH_REQUIRED", "Sign in to OurTube to continue.", 401),
      );
    }

    const connection = await fetchCurrentConnection(routeClient.supabase, {
      id: data.user.id,
      email: data.user.email ?? null,
      name: "You",
      avatarUrl: null,
    });
    if (connection.status !== "CONNECTED") {
      return applyTo(
        jsonError(
          "NOT_CONNECTED",
          "Connect with your partner before browsing YouTube.",
          403,
        ),
      );
    }

    const accessToken = request.cookies.get(YOUTUBE_ACCESS_COOKIE)?.value;
    const ownerBinding = request.cookies.get(YOUTUBE_OWNER_COOKIE)?.value;
    if (!isAccessToken(accessToken) || !isOwnerBinding(ownerBinding)) {
      const response = jsonError(
        "YOUTUBE_AUTH_REQUIRED",
        "Connect your YouTube account to continue.",
        401,
      );
      clearYouTubeAccessCookies(response);
      return applyTo(response);
    }

    const expectedOwnerBinding = await createYouTubeOwnerBinding(
      data.user.id,
      accessToken,
    );
    if (ownerBinding !== expectedOwnerBinding) {
      const response = jsonError(
        "YOUTUBE_AUTH_REQUIRED",
        "Reconnect YouTube with this OurTube account to continue.",
        401,
      );
      clearYouTubeAccessCookies(response);
      return applyTo(response);
    }

    const results = await discoverYouTubeVideos(
      accessToken,
      parsed.kind,
      parsed.query,
    );
    return applyTo(jsonSuccess(results));
  } catch (error) {
    const mapped =
      error instanceof YouTubeApiError
        ? error
        : new YouTubeApiError(
            "YOUTUBE_UNAVAILABLE",
            503,
            "YouTube is temporarily unavailable. Please try again.",
          );
    const response = jsonError(mapped.code, mapped.message, mapped.status);
    if (mapped.code === "YOUTUBE_AUTH_REQUIRED") {
      clearYouTubeAccessCookies(response);
    }
    return applyTo ? applyTo(response) : response;
  }
}

function isOwnerBinding(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/u.test(value));
}

function clearYouTubeAccessCookies(response: NextResponse): void {
  response.cookies.set(YOUTUBE_ACCESS_COOKIE, "", youtubeAccessCookieOptions(0));
  response.cookies.set(YOUTUBE_OWNER_COOKIE, "", youtubeAccessCookieOptions(0));
}

function parseRequest(searchParams: URLSearchParams):
  | { ok: true; kind: YouTubeKind; query: string }
  | { ok: false; message: string } {
  for (const key of searchParams.keys()) {
    if (key !== "kind" && key !== "q") {
      return { ok: false, message: "Only kind and q are supported." };
    }
  }

  const kinds = searchParams.getAll("kind");
  const queries = searchParams.getAll("q");
  if (
    kinds.length !== 1 ||
    (kinds[0] !== "video" && kinds[0] !== "short") ||
    queries.length > 1
  ) {
    return { ok: false, message: "Choose either video or short." };
  }

  const rawQuery = queries[0] ?? "";
  if (rawQuery.length > 100 || /[\u0000-\u001f\u007f]/u.test(rawQuery)) {
    return { ok: false, message: "Search text is invalid or too long." };
  }

  const normalizedQuery = rawQuery.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalizedQuery.length > 100) {
    return { ok: false, message: "Search text is invalid or too long." };
  }

  return {
    ok: true,
    kind: kinds[0],
    query: normalizedQuery,
  };
}

function isAccessToken(value: string | undefined): value is string {
  return Boolean(
    value &&
      value.length >= 20 &&
      value.length <= 4_096 &&
      !/[\u0000-\u0020\u007f]/u.test(value),
  );
}

function jsonSuccess(results: readonly YouTubeResult[]) {
  return json({ results }, 200);
}

function jsonError(code: ErrorCode, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
