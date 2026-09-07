"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { YouTubeEmbed } from "./youtube-embed";

export type YouTubePickerSelection = Readonly<{
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  youtubeUrl: string;
}>;

type YouTubePickerProps = {
  disabled?: boolean;
  initialOAuthError?: string | null;
  kind: "video" | "short";
  onShare: (selection: YouTubePickerSelection) => void;
  partnerName: string;
  viewerEmail?: string | null;
};

type LoadState = "idle" | "loading" | "ready" | "error";

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ALLOWED_THUMBNAIL_HOSTS = new Set(["i.ytimg.com", "img.youtube.com"]);

export function YouTubePicker({
  disabled = false,
  initialOAuthError = null,
  kind,
  onShare,
  partnerName,
  viewerEmail = null,
}: YouTubePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly YouTubePickerSelection[]>([]);
  const [selected, setSelected] = useState<YouTubePickerSelection | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const latestRequest = useRef<AbortController | null>(null);
  const oauthError = youtubeOAuthErrorMessage(initialOAuthError, viewerEmail);

  const loadResults = useCallback(async (queryValue: string) => {
    latestRequest.current?.abort();
    const controller = new AbortController();
    latestRequest.current = controller;
    const normalizedQuery = queryValue.trim();

    setLoadState("loading");
    setAuthRequired(false);
    setError(null);
    setLastQuery(normalizedQuery);

    try {
      const params = new URLSearchParams({ kind, q: normalizedQuery });
      const response = await fetch(`/api/youtube/search?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (response.status === 401) {
        setResults([]);
        setSelected(null);
        setAuthRequired(true);
        setLoadState("ready");
        return;
      }

      if (!response.ok) throw new YouTubePickerError(await readApiError(response));

      const payload: unknown = await response.json();
      const parsed = parseSearchResults(payload, kind);
      if (!parsed) {
        throw new Error("youtube_response_invalid");
      }

      setResults(parsed);
      setSelected((current) =>
        current && parsed.some((item) => item.videoId === current.videoId)
          ? current
          : null,
      );
      setLoadState("ready");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setResults([]);
      setSelected(null);
      setLoadState("error");
      setError(
        caught instanceof YouTubePickerError
          ? caught.message
          : "YouTube is unavailable right now. Please try again in a moment.",
      );
    }
  }, [kind]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadResults(""), 0);
    return () => {
      window.clearTimeout(initialLoad);
      latestRequest.current?.abort();
    };
  }, [loadResults]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadResults(query);
  }

  const itemLabel = kind === "short" ? "Short" : "video";
  const connectNext = `/our-space?picker=${kind}`;
  const connectHref = `/api/auth/youtube?next=${encodeURIComponent(connectNext)}`;

  return (
    <section
      className="youtube-picker"
      aria-label={`Choose a YouTube ${itemLabel}`}
      aria-busy={loadState === "loading"}
    >
      <div className="youtube-picker__heading">
        <div>
          <strong>Browse YouTube inside OurTube</strong>
          <p>Find a {itemLabel} and share it with {partnerName} without pasting a link.</p>
        </div>
        <span className="youtube-picker__brand" aria-label="Results provided by YouTube">YouTube</span>
      </div>

      {authRequired ? (
        <div className="youtube-picker__connect" role="status">
          <h2>Connect YouTube to browse</h2>
          {oauthError && <p className="form-error" role="alert">{oauthError}</p>}
          <p>
            Use the same Google account you use to sign in to OurTube
            {viewerEmail ? <>: <strong>{viewerEmail}</strong></> : "."}
            {viewerEmail ? ". " : " "}You will confirm it on Google&apos;s secure page.
          </p>
          <p className="youtube-picker__consent">
            By selecting the button below, you agree to the YouTube API Services{" "}
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            {" "}and acknowledge the{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.
            You can review <Link href="/privacy">OurTube&apos;s privacy details</Link> too.
          </p>
          <a className="primary-button primary-button--small" href={connectHref}>
            {viewerEmail ? `Continue with ${viewerEmail}` : "Connect the same Google account"}
          </a>
        </div>
      ) : (
        <>
          <form className="youtube-picker__search" onSubmit={search} role="search">
            <label className="sr-only" htmlFor={`youtube-${kind}-search`}>
              Search YouTube for a {itemLabel}
            </label>
            <input
              id={`youtube-${kind}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={kind === "short" ? "Search YouTube Shorts" : "Search YouTube"}
              autoComplete="off"
              maxLength={100}
              disabled={loadState === "loading"}
            />
            <button className="primary-button primary-button--small" type="submit" disabled={loadState === "loading"}>
              {loadState === "loading" ? "Searching…" : "Search"}
            </button>
          </form>

          <div className="youtube-picker__status" aria-live="polite">
            {loadState === "loading" && <p>Loading {kind === "short" ? "Shorts" : "videos"} from YouTube…</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>

          {selected && (
            <section className="youtube-picker__selection" aria-label="Selected YouTube result" aria-live="polite">
              <YouTubeEmbed
                active
                badge="YouTube"
                onPlay={() => undefined}
                title={selected.title}
                variant={kind}
                videoId={selected.videoId}
              />
              <div className="youtube-picker__selection-copy">
                <div>
                  <span>YouTube · {selected.channelTitle}</span>
                  <h2>{selected.title}</h2>
                  <a href={selected.youtubeUrl} target="_blank" rel="noopener noreferrer">
                    Open on YouTube <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <button
                  className="primary-button primary-button--small"
                  type="button"
                  onClick={() => onShare(selected)}
                  disabled={disabled}
                >
                  {disabled ? "Sharing…" : `Share with ${partnerName}`}
                </button>
              </div>
            </section>
          )}

          {loadState === "ready" && results.length === 0 && !selected && (
            <p className="youtube-picker__empty">
              {lastQuery
                ? `No YouTube ${kind === "short" ? "Shorts" : "videos"} matched that search.`
                : `No YouTube ${kind === "short" ? "Shorts" : "videos"} are available to browse yet.`}
            </p>
          )}

          {results.length > 0 && (
            <ul className="youtube-picker__results" aria-label={`YouTube ${kind === "short" ? "Shorts" : "video"} results`}>
              {results.map((result) => (
                <li key={result.videoId}>
                  <button
                    className={selected?.videoId === result.videoId ? "is-selected" : undefined}
                    type="button"
                    onClick={() => setSelected(result)}
                    aria-pressed={selected?.videoId === result.videoId}
                    aria-label={`Preview ${result.title} by ${result.channelTitle} from YouTube`}
                  >
                    <Image
                      src={result.thumbnailUrl}
                      alt=""
                      unoptimized
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      width={320}
                      height={180}
                    />
                    <span className="youtube-picker__result-copy">
                      <strong>{result.title}</strong>
                      <span>{result.channelTitle}</span>
                      <span>YouTube · {formatPublishedAt(result.publishedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function parseSearchResults(
  payload: unknown,
  kind: "video" | "short",
): readonly YouTubePickerSelection[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return null;

  const parsed: YouTubePickerSelection[] = [];
  const seen = new Set<string>();

  for (const item of payload.results) {
    if (!isRecord(item)) return null;
    const { videoId, title, channelTitle, publishedAt, thumbnailUrl, youtubeUrl } = item;
    if (
      typeof videoId !== "string" || !YOUTUBE_VIDEO_ID.test(videoId) ||
      typeof title !== "string" || !title.trim() || title.length > 200 ||
      typeof channelTitle !== "string" || !channelTitle.trim() || channelTitle.length > 200 ||
      typeof publishedAt !== "string" || !Number.isFinite(Date.parse(publishedAt)) ||
      typeof thumbnailUrl !== "string" || !isSafeThumbnail(thumbnailUrl) ||
      typeof youtubeUrl !== "string" || !isMatchingYouTubeUrl(youtubeUrl, videoId, kind)
    ) {
      return null;
    }

    if (seen.has(videoId)) continue;
    seen.add(videoId);
    parsed.push({
      videoId,
      title: title.trim(),
      channelTitle: channelTitle.trim(),
      publishedAt,
      thumbnailUrl,
      youtubeUrl: kind === "short"
        ? `https://www.youtube.com/shorts/${videoId}`
        : `https://www.youtube.com/watch?v=${videoId}`,
    });
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeThumbnail(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_THUMBNAIL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isMatchingYouTubeUrl(value: string, videoId: string, kind: "video" | "short"): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com"].includes(url.hostname.toLowerCase())) {
      return false;
    }
    return kind === "short"
      ? url.pathname === `/shorts/${videoId}`
      : url.pathname === "/watch" && url.searchParams.get("v") === videoId;
  } catch {
    return false;
  }
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

class YouTubePickerError extends Error {}

async function readApiError(response: Response): Promise<string> {
  const fallback = "YouTube is unavailable right now. Please try again in a moment.";
  try {
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.error)) return fallback;
    const { message } = payload.error;
    return typeof message === "string" && message.length > 0 && message.length <= 200
      ? message
      : fallback;
  } catch {
    return fallback;
  }
}

function youtubeOAuthErrorMessage(
  code: string | null,
  viewerEmail: string | null,
): string | null {
  switch (code) {
    case "youtube_account_mismatch":
      return viewerEmail
        ? `Google returned a different account. Please choose ${viewerEmail}.`
        : "Google returned a different account. Please choose the account used for OurTube.";
    case "youtube_oauth_expired":
      return "That YouTube connection request expired. Please try again.";
    case "youtube_oauth_failed":
      return "YouTube permission was not completed. Try again and approve read-only access.";
    case "youtube_oauth_start_failed":
      return "OurTube could not start the YouTube connection. Please try again.";
    case "supabase_not_configured":
    case "site_url_not_configured":
      return "This deployment is not configured for Google sign-in yet.";
    default:
      return null;
  }
}
