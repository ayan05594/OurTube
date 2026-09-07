"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import type { RealtimeStatus } from "@/lib/connections/realtime";
import type { ActionResult } from "@/lib/connections/types";

import type { ConnectedContent } from "./types";

/**
 * Subscribe to a payload-free private Broadcast topic, then reload a sanitized
 * snapshot. Database triggers cover inserts, updates, and deletes without ever
 * delivering the changed private row to the browser.
 */
export function subscribeToContentChanges(
  onChange: (content: ConnectedContent) => void,
  onStatus?: (status: RealtimeStatus) => void,
): () => void {
  const supabase = createClient();
  let stopped = false;
  let channel: RealtimeChannel | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let activeRequest: AbortController | null = null;

  const refresh = () => {
    if (stopped || refreshTimer) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      activeRequest?.abort();
      activeRequest = new AbortController();

      try {
        const response = await fetch("/api/content", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: activeRequest.signal,
        });
        const value: unknown = await response.json();
        if (!stopped && isContentResult(value) && value.ok) {
          onChange(value.data);
        }
      } catch (error) {
        if (!isAbortError(error)) onStatus?.("CHANNEL_ERROR");
      }
    }, 75);
  };

  void subscribeToPrivateTopic();

  async function subscribeToPrivateTopic() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user || stopped) {
        if (!stopped) onStatus?.("CHANNEL_ERROR");
        return;
      }

      await supabase.realtime.setAuth();
      if (stopped) return;

      channel = supabase
        .channel(`content:${data.user.id}`, {
          config: { private: true },
        })
        .on("broadcast", { event: "content_changed" }, refresh)
        .subscribe((status) => {
          if (isRealtimeStatus(status)) onStatus?.(status);
          if (status === "SUBSCRIBED") refresh();
        });
    } catch {
      if (!stopped) onStatus?.("CHANNEL_ERROR");
    }
  }

  return () => {
    stopped = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    activeRequest?.abort();
    if (channel) void supabase.removeChannel(channel);
  };
}

function isContentResult(value: unknown): value is ActionResult<ConnectedContent> {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (value.ok) {
    return (
      isRecord(value.data) &&
      Array.isArray(value.data.messages) &&
      Array.isArray(value.data.sharedVideos) &&
      Array.isArray(value.data.favorites)
    );
  }
  return isRecord(value.error) && typeof value.error.code === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRealtimeStatus(value: string): value is RealtimeStatus {
  return (
    value === "SUBSCRIBED" ||
    value === "TIMED_OUT" ||
    value === "CLOSED" ||
    value === "CHANNEL_ERROR"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
