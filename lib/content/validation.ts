import { invalidInput } from "@/lib/connections/errors";

import type {
  FavoriteVisibility,
  ReactionEmoji,
  ShareMediaInput,
} from "./types";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_REACTIONS = new Set<ReactionEmoji>(["👍", "❤️", "😂", "😮", "😢", "🔥"]);

export type NormalizedMedia = Readonly<{
  youtubeVideoId: string;
  youtubeUrl: string;
  title: string | null;
  note: string | null;
}>;

export function validateTextMessage(input: string): string {
  const value = input.normalize("NFKC").trim();
  if (!value || value.length > 4000) throw invalidInput("message");
  return value;
}

export function validateMedia(
  input: ShareMediaInput,
  type: "video" | "short",
): NormalizedMedia {
  const source = input.youtubeUrl.trim();
  if (!source || source.length > 2048) throw invalidInput("youtubeUrl");

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw invalidInput("youtubeUrl");
  }

  if (url.protocol !== "https:") throw invalidInput("youtubeUrl");

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId: string | null = null;
  let sourceIsShort = false;

  if (hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
    const path = url.pathname.split("/").filter(Boolean);
    if (path[0] === "shorts") {
      sourceIsShort = true;
      videoId = path[1] ?? null;
    } else if (path[0] === "embed") {
      videoId = path[1] ?? null;
    } else if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    }
  }

  if (!videoId || !YOUTUBE_ID.test(videoId)) throw invalidInput("youtubeUrl");
  if (type === "short" && !sourceIsShort) {
    // The dedicated Shorts action deliberately requires a Shorts URL so a
    // caller cannot mislabel arbitrary content.
    throw invalidInput("youtubeUrl");
  }

  return {
    youtubeVideoId: videoId,
    youtubeUrl:
      type === "short"
        ? `https://www.youtube.com/shorts/${videoId}`
        : `https://www.youtube.com/watch?v=${videoId}`,
    title: optionalText(input.title, 200, "title"),
    note: optionalText(input.note, 1000, "note"),
  };
}

export function validateMessageId(value: string): string {
  const id = value.trim();
  if (!MESSAGE_ID.test(id)) throw invalidInput("messageId");
  return id;
}

export function validateFavoriteId(value: string): string {
  const id = value.trim();
  if (!MESSAGE_ID.test(id)) throw invalidInput("favoriteId");
  return id;
}

export function validateReaction(value: string): ReactionEmoji {
  if (!ALLOWED_REACTIONS.has(value as ReactionEmoji)) throw invalidInput("emoji");
  return value as ReactionEmoji;
}

export function validateVisibility(value: string): FavoriteVisibility {
  if (value !== "private" && value !== "shared") {
    throw invalidInput("visibility");
  }
  return value;
}

function optionalText(
  input: string | null | undefined,
  maxLength: number,
  field: string,
): string | null {
  if (input == null) return null;
  const value = input.normalize("NFKC").trim();
  if (!value) return null;
  if (value.length > maxLength) throw invalidInput(field);
  return value;
}
