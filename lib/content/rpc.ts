import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fromDatabaseErrorCode,
  fromPostgrestError,
} from "@/lib/connections/errors";
import type { ActionError } from "@/lib/connections/types";
import type { Database, Json } from "@/lib/supabase/database.types";

import { parseConnectedContent } from "./parse";
import type {
  ConnectedContent,
  FavoriteVisibility,
  MessageMetadata,
  MessageType,
  ReactionEmoji,
} from "./types";

type ContentClient = SupabaseClient<Database>;

export async function fetchConnectedContent(
  supabase: ContentClient,
): Promise<ConnectedContent> {
  const { data, error } = await supabase.rpc("get_connected_content");
  if (error) throw fromPostgrestError(error);
  return parseConnectedContent(data);
}

export async function createMessage(
  supabase: ContentClient,
  input: Readonly<{
    type: MessageType;
    content: string | null;
    youtubeVideoId: string | null;
    youtubeUrl: string | null;
    metadata: MessageMetadata;
  }>,
): Promise<ConnectedContent> {
  const { data, error } = await supabase.rpc("send_message", {
    p_type: input.type,
    p_content: input.content,
    p_youtube_video_id: input.youtubeVideoId,
    p_youtube_url: input.youtubeUrl,
    p_metadata: input.metadata as Json,
  });
  if (error) throw fromPostgrestError(error);
  throwIfContentMutationError(data);
  return fetchConnectedContent(supabase);
}

export async function toggleReaction(
  supabase: ContentClient,
  messageId: string,
  reaction: ReactionEmoji,
): Promise<ConnectedContent> {
  const { data, error } = await supabase.rpc("toggle_message_reaction", {
    p_message_id: messageId,
    p_reaction: reaction,
  });
  if (error) throw fromPostgrestError(error);
  throwIfContentMutationError(data);
  return fetchConnectedContent(supabase);
}

export async function toggleVideoFavorite(
  supabase: ContentClient,
  input: Readonly<{
    youtubeVideoId: string;
    youtubeUrl: string;
    type: "video" | "short";
    visibility: FavoriteVisibility;
  }>,
): Promise<ConnectedContent> {
  const { data, error } = await supabase.rpc("toggle_favorite", {
    p_youtube_video_id: input.youtubeVideoId,
    p_youtube_url: input.youtubeUrl,
    p_type: input.type,
    p_visibility: input.visibility,
  });
  if (error) throw fromPostgrestError(error);
  throwIfContentMutationError(data);
  return fetchConnectedContent(supabase);
}

export async function changeFavoriteVisibility(
  supabase: ContentClient,
  favoriteId: string,
  visibility: FavoriteVisibility,
): Promise<ConnectedContent> {
  const { data, error } = await supabase.rpc("set_favorite_visibility", {
    p_favorite_id: favoriteId,
    p_visibility: visibility,
  });
  if (error) throw fromPostgrestError(error);
  throwIfContentMutationError(data);
  return fetchConnectedContent(supabase);
}

function throwIfContentMutationError(value: unknown): void {
  const record = asRecord(value);
  if (!record || typeof record.error_code !== "string") return;

  const retryAfterSeconds = positiveInteger(
    record.retry_after_seconds,
    86_400,
  );
  const resource = quotaResource(record.resource);
  const limit = positiveInteger(record.limit, 1_000_000);

  throw fromDatabaseErrorCode(
    record.error_code,
    retryAfterSeconds,
    resource,
    limit,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function quotaResource(value: unknown): ActionError["resource"] {
  return value === "messages" ||
    value === "message_reactions" ||
    value === "favorites"
    ? value
    : undefined;
}

function positiveInteger(value: unknown, maximum: number): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= maximum
    ? value
    : undefined;
}
