"use server";

import { revalidatePath } from "next/cache";

import { requireAuthenticatedContext } from "@/lib/auth/session";
import {
  changeFavoriteVisibility,
  createMessage,
  fetchConnectedContent,
  toggleReaction,
  toggleVideoFavorite,
} from "@/lib/content/rpc";
import type {
  ConnectedContent,
  SetFavoriteVisibilityInput,
  ShareMediaInput,
  ToggleFavoriteInput,
  ToggleReactionInput,
} from "@/lib/content/types";
import {
  validateFavoriteId,
  validateMedia,
  validateMessageId,
  validateReaction,
  validateTextMessage,
  validateVisibility,
} from "@/lib/content/validation";
import { invalidInput, toActionError } from "@/lib/connections/errors";
import type { ActionResult } from "@/lib/connections/types";

export async function refreshConnectedContent(): Promise<
  ActionResult<ConnectedContent>
> {
  return execute(async () => {
    const { supabase } = await requireAuthenticatedContext();
    return fetchConnectedContent(supabase);
  }, false);
}

export async function sendTextMessage(
  input: string | FormData,
): Promise<ActionResult<ConnectedContent>> {
  return execute(async () => {
    const text = validateTextMessage(
      typeof input === "string" ? input : readRequired(input, "message"),
    );
    const { supabase } = await requireAuthenticatedContext();
    return createMessage(supabase, {
      type: "text",
      content: text,
      youtubeVideoId: null,
      youtubeUrl: null,
      metadata: {},
    });
  });
}

export async function shareVideo(
  input: ShareMediaInput | FormData,
): Promise<ActionResult<ConnectedContent>> {
  return shareMedia(input, "video");
}

export async function shareShort(
  input: ShareMediaInput | FormData,
): Promise<ActionResult<ConnectedContent>> {
  return shareMedia(input, "short");
}

export async function toggleMessageReaction(
  input: ToggleReactionInput | FormData,
): Promise<ActionResult<ConnectedContent>> {
  return execute(async () => {
    const value = isFormData(input)
      ? {
          messageId: readRequired(input, "messageId"),
          emoji: readRequired(input, "emoji"),
        }
      : input;
    const messageId = validateMessageId(value.messageId);
    const emoji = validateReaction(value.emoji);
    const { supabase } = await requireAuthenticatedContext();
    return toggleReaction(supabase, messageId, emoji);
  });
}

export async function toggleFavorite(
  input: ToggleFavoriteInput | FormData,
): Promise<ActionResult<ConnectedContent>> {
  return execute(async () => {
    const value = isFormData(input)
      ? {
          youtubeUrl: readRequired(input, "youtubeUrl"),
          type: readRequired(input, "type"),
          visibility: readRequired(input, "visibility"),
        }
      : input;
    if (value.type !== "video" && value.type !== "short") {
      throw invalidInput("type");
    }
    const visibility = validateVisibility(value.visibility);
    const media = validateMedia({ youtubeUrl: value.youtubeUrl }, value.type);
    const { supabase } = await requireAuthenticatedContext();
    return toggleVideoFavorite(supabase, {
      youtubeVideoId: media.youtubeVideoId,
      youtubeUrl: media.youtubeUrl,
      type: value.type,
      visibility,
    });
  });
}

export async function setFavoriteVisibility(
  input: SetFavoriteVisibilityInput | FormData,
): Promise<ActionResult<ConnectedContent>> {
  return execute(async () => {
    const value = isFormData(input)
      ? {
          favoriteId: readRequired(input, "favoriteId"),
          visibility: readRequired(input, "visibility"),
        }
      : input;
    const favoriteId = validateFavoriteId(value.favoriteId);
    const visibility = validateVisibility(value.visibility);
    const { supabase } = await requireAuthenticatedContext();
    return changeFavoriteVisibility(
      supabase,
      favoriteId,
      visibility,
    );
  });
}

async function shareMedia(
  input: ShareMediaInput | FormData,
  type: "video" | "short",
): Promise<ActionResult<ConnectedContent>> {
  return execute(async () => {
    const value = isFormData(input)
      ? {
          youtubeUrl: readRequired(input, "youtubeUrl"),
          title: readOptional(input, "title"),
          note: readOptional(input, "note"),
        }
      : input;
    const media = validateMedia(value, type);
    const metadata = {
      ...(media.title ? { title: media.title } : {}),
      ...(media.note ? { note: media.note } : {}),
    };
    const { supabase } = await requireAuthenticatedContext();
    return createMessage(supabase, {
      type,
      content: media.note,
      youtubeVideoId: media.youtubeVideoId,
      youtubeUrl: media.youtubeUrl,
      metadata,
    });
  });
}

async function execute(
  operation: () => Promise<ConnectedContent>,
  revalidate = true,
): Promise<ActionResult<ConnectedContent>> {
  try {
    const data = await operation();
    if (revalidate) {
      revalidatePath("/our-space");
      revalidatePath("/", "layout");
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

function isFormData(value: object): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function readRequired(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string") throw invalidInput(name);
  return value;
}

function readOptional(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}
