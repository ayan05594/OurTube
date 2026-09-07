"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

import type { ActionResult, CurrentConnection } from "./types";

export type RealtimeStatus =
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CLOSED"
  | "CHANNEL_ERROR";

export function subscribeToConnectionChanges(
  onChange: (connection: CurrentConnection) => void,
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
        const response = await fetch("/api/connection", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: activeRequest.signal,
        });
        const value: unknown = await response.json();
        if (!stopped && isConnectionResult(value) && value.ok) {
          onChange(value.data);
        }
      } catch (error) {
        if (!isAbortError(error)) onStatus?.("CHANNEL_ERROR");
      }
    }, 75);
  };

  // Postgres Changes (`postgres_changes`) on connection_members/connections
  // would deliver full rows, including internal connection IDs. The migration
  // instead emits payload-free refresh signals on an RLS-protected user topic.
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
        .channel(`connection:${data.user.id}`, {
          config: { private: true },
        })
        .on("broadcast", { event: "connection_changed" }, refresh)
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

function isConnectionResult(value: unknown): value is ActionResult<CurrentConnection> {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (value.ok) {
    return isRecord(value.data) && typeof value.data.status === "string";
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
