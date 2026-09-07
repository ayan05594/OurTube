import "server-only";

const YOUTUBE_API_ORIGIN = "https://www.googleapis.com";
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_RESULTS = 12;

export type YouTubeKind = "video" | "short";

export type YouTubeResult = Readonly<{
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  youtubeUrl: string;
}>;

export class YouTubeApiError extends Error {
  constructor(
    readonly code:
      | "YOUTUBE_AUTH_REQUIRED"
      | "YOUTUBE_ACCESS_DENIED"
      | "YOUTUBE_RATE_LIMITED"
      | "YOUTUBE_UNAVAILABLE",
    readonly status: 401 | 403 | 429 | 503,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export async function discoverYouTubeVideos(
  accessToken: string,
  kind: YouTubeKind,
  query: string,
): Promise<readonly YouTubeResult[]> {
  const endpoint = query.length > 0 || kind === "short" ? "search" : "videos";
  const url = new URL(`/youtube/v3/${endpoint}`, YOUTUBE_API_ORIGIN);

  url.searchParams.set(
    "part",
    endpoint === "videos" ? "snippet,status" : "snippet",
  );
  url.searchParams.set("maxResults", String(MAX_RESULTS));

  if (endpoint === "videos") {
    url.searchParams.set("chart", "mostPopular");
  } else {
    url.searchParams.set("type", "video");
    url.searchParams.set("safeSearch", "strict");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("videoSyndicated", "true");
    if (query) url.searchParams.set("q", query);
    if (kind === "short") {
      url.searchParams.set("videoDuration", "short");
      if (!query) url.searchParams.set("order", "viewCount");
    }
  }

  const payload = await youtubeRequest(url, accessToken);
  return parseResults(payload, kind, endpoint === "videos");
}

async function youtubeRequest(url: URL, accessToken: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new YouTubeApiError(
      "YOUTUBE_UNAVAILABLE",
      503,
      "YouTube is temporarily unavailable. Please try again.",
    );
  }

  if (!response.ok) {
    const reason =
      response.status === 403 ? await readYouTubeFailureReason(response) : null;
    throw mapYouTubeFailure(response.status, reason);
  }

  try {
    return await response.json();
  } catch {
    throw new YouTubeApiError(
      "YOUTUBE_UNAVAILABLE",
      503,
      "YouTube returned an unreadable response. Please try again.",
    );
  }
}

function mapYouTubeFailure(
  status: number,
  reason: string | null,
): YouTubeApiError {
  if (status === 401) {
    return new YouTubeApiError(
      "YOUTUBE_AUTH_REQUIRED",
      401,
      "Connect your YouTube account to continue.",
    );
  }
  if (status === 403) {
    if (
      reason === "quotaExceeded" ||
      reason === "dailyLimitExceeded" ||
      reason === "rateLimitExceeded" ||
      reason === "userRateLimitExceeded"
    ) {
      return new YouTubeApiError(
        "YOUTUBE_RATE_LIMITED",
        429,
        "YouTube is receiving too many requests. Please try again shortly.",
      );
    }
    if (reason === "accessNotConfigured" || reason === "apiNotActivated") {
      return new YouTubeApiError(
        "YOUTUBE_UNAVAILABLE",
        503,
        "The YouTube Data API is not enabled for this app yet.",
      );
    }
    if (reason === "insufficientPermissions") {
      return new YouTubeApiError(
        "YOUTUBE_AUTH_REQUIRED",
        401,
        "Reconnect YouTube and approve read-only access to continue.",
      );
    }
    return new YouTubeApiError(
      "YOUTUBE_ACCESS_DENIED",
      403,
      "YouTube access was denied. Reconnect YouTube and try again.",
    );
  }
  if (status === 429) {
    return new YouTubeApiError(
      "YOUTUBE_RATE_LIMITED",
      429,
      "YouTube is receiving too many requests. Please try again shortly.",
    );
  }
  return new YouTubeApiError(
    "YOUTUBE_UNAVAILABLE",
    503,
    "YouTube is temporarily unavailable. Please try again.",
  );
}

async function readYouTubeFailureReason(
  response: Response,
): Promise<string | null> {
  try {
    const text = (await response.text()).slice(0, 32_768);
    const payload: unknown = JSON.parse(text);
    if (!isRecord(payload) || !isRecord(payload.error)) return null;
    const errors = payload.error.errors;
    if (!Array.isArray(errors)) return null;
    for (const entry of errors) {
      if (isRecord(entry) && typeof entry.reason === "string") {
        return entry.reason;
      }
    }
  } catch {
    // Provider error bodies are optional and never returned to the browser.
  }
  return null;
}

function parseResults(
  payload: unknown,
  kind: YouTubeKind,
  requireEmbeddableStatus: boolean,
): readonly YouTubeResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new YouTubeApiError(
      "YOUTUBE_UNAVAILABLE",
      503,
      "YouTube returned an unexpected response. Please try again.",
    );
  }

  const results: YouTubeResult[] = [];
  const seen = new Set<string>();
  for (const item of payload.items) {
    if (!isRecord(item) || !isRecord(item.snippet)) continue;
    if (
      requireEmbeddableStatus &&
      (!isRecord(item.status) || item.status.embeddable !== true)
    ) {
      continue;
    }

    const rawId = isRecord(item.id) ? item.id.videoId : item.id;
    if (typeof rawId !== "string" || !YOUTUBE_VIDEO_ID.test(rawId)) continue;
    if (seen.has(rawId)) continue;
    seen.add(rawId);

    const title = cleanText(item.snippet.title, 200, "YouTube video");
    const channelTitle = cleanText(
      item.snippet.channelTitle,
      160,
      "YouTube",
    );
    const publishedAt = cleanPublishedAt(item.snippet.publishedAt);
    if (!publishedAt) continue;

    results.push({
      videoId: rawId,
      title,
      channelTitle,
      publishedAt,
      thumbnailUrl: `https://i.ytimg.com/vi/${rawId}/mqdefault.jpg`,
      youtubeUrl:
        kind === "short"
          ? `https://www.youtube.com/shorts/${rawId}`
          : `https://www.youtube.com/watch?v=${rawId}`,
    });
    if (results.length === MAX_RESULTS) break;
  }

  return results;
}

function cleanText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return clean ? clean.slice(0, maxLength) : fallback;
}

function cleanPublishedAt(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) return "";
  return Number.isFinite(Date.parse(value)) ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
