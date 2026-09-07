import type { Json } from "@/lib/supabase/database.types";

import type {
  ConnectedContent,
  Favorite,
  FavoriteVisibility,
  MessageMetadata,
  MessageType,
  OurTubeMessage,
  ReactionSummary,
  SharedVideo,
} from "./types";

export function parseConnectedContent(
  value: Json,
): ConnectedContent {
  const root = asRecord(value);
  if (!root) throw new Error("Malformed connected content response.");

  const messages = asArray(root.messages)
    .map((entry) => parseMessage(entry))
    .filter(isPresent);
  const favorites = asArray(root.favorites)
    .map((entry) => parseFavorite(entry))
    .filter(isPresent);
  const sharedVideos = messages
    .map(toSharedVideo)
    .filter(isPresent);

  return { messages, sharedVideos, favorites };
}

function parseMessage(value: Json): OurTubeMessage | null {
  const row = asRecord(value);
  if (!row) return null;

  const id = readString(row, "id");
  const type = parseMessageType(readString(row, "type"));
  const createdAt = readString(row, "created_at", "createdAt");
  const isMine = readBoolean(row, "is_mine", "isMine");
  if (!id || !type || !createdAt || isMine === null) return null;

  const sender = asRecord(row.sender);

  return {
    id,
    type,
    content: readString(row, "content"),
    youtubeVideoId: readString(
      row,
      "youtube_video_id",
      "youtubeVideoId",
    ),
    youtubeUrl: readString(row, "youtube_url", "youtubeUrl"),
    metadata: parseMetadata(row.metadata),
    createdAt,
    updatedAt: readString(row, "updated_at", "updatedAt") ?? createdAt,
    isMine,
    sender: {
      name:
        (sender &&
          readString(sender, "display_name", "full_name", "name")) ??
        (isMine ? "You" : "Your partner"),
      avatarUrl: safeImageUrl(
        sender && readString(sender, "avatar_url", "avatarUrl", "picture"),
      ),
    },
    reactions: parseReactions(row.reactions),
  };
}

function parseFavorite(value: Json): Favorite | null {
  const row = asRecord(value);
  if (!row) return null;

  const id = readString(row, "id");
  const type = readString(row, "type");
  const visibility = parseVisibility(readString(row, "visibility"));
  const youtubeVideoId = readString(
    row,
    "youtube_video_id",
    "youtubeVideoId",
  );
  const youtubeUrl = readString(row, "youtube_url", "youtubeUrl");
  const createdAt = readString(row, "created_at", "createdAt");
  const createdByViewer = readBoolean(
    row,
    "created_by_viewer",
    "createdByViewer",
  );

  if (
    !id ||
    (type !== "video" && type !== "short") ||
    !visibility ||
    !youtubeVideoId ||
    !youtubeUrl ||
    !createdAt ||
    createdByViewer === null
  ) {
    return null;
  }

  return {
    id,
    type,
    visibility,
    youtubeVideoId,
    youtubeUrl,
    createdAt,
    createdByViewer,
  };
}

function parseReactions(value: Json | undefined): ReactionSummary[] {
  const grouped = new Map<string, { count: number; reactedByViewer: boolean }>();

  asArray(value).forEach((entry) => {
    const row = asRecord(entry);
    if (!row) return;
    const emoji = readString(row, "reaction", "emoji");
    const reactedByViewer = readBoolean(
      row,
      "reacted_by_viewer",
      "reactedByViewer",
    );
    if (!emoji || reactedByViewer === null) return;

    const existing = grouped.get(emoji) ?? { count: 0, reactedByViewer: false };
    const suppliedCount = readNumber(row, "count");

    grouped.set(emoji, {
      count: existing.count + (suppliedCount ?? 1),
      reactedByViewer: existing.reactedByViewer || reactedByViewer,
    });
  });

  return Array.from(grouped, ([emoji, summary]) => ({ emoji, ...summary }));
}

function toSharedVideo(message: OurTubeMessage): SharedVideo | null {
  if (
    (message.type !== "video" && message.type !== "short") ||
    !message.youtubeVideoId ||
    !message.youtubeUrl
  ) {
    return null;
  }

  const title = message.metadata.title;
  return {
    messageId: message.id,
    type: message.type,
    youtubeVideoId: message.youtubeVideoId,
    youtubeUrl: message.youtubeUrl,
    title: typeof title === "string" ? title : null,
    sharedAt: message.createdAt,
    sharedByViewer: message.isMine,
  };
}

function parseMetadata(value: Json | undefined): MessageMetadata {
  const record = asRecord(value);
  if (!record) return {};

  const metadata: Record<string, string | number | boolean | null> = {};
  Object.entries(record).forEach(([key, entry]) => {
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      metadata[key] = entry;
    }
  });
  return metadata;
}

function parseMessageType(value: string | null): MessageType | null {
  return value === "text" || value === "video" || value === "short"
    ? value
    : null;
}

function parseVisibility(value: string | null): FavoriteVisibility | null {
  return value === "private" || value === "shared" ? value : null;
}

function asRecord(value: Json | undefined): Record<string, Json | undefined> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return typeof value === "object" && value !== null ? value : null;
}

function asArray(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function readString(
  record: Record<string, Json | undefined>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readBoolean(
  record: Record<string, Json | undefined>,
  ...keys: string[]
): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function readNumber(
  record: Record<string, Json | undefined>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function safeImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
