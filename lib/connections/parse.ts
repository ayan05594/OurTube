import type { Json } from "@/lib/supabase/database.types";
import type { AuthenticatedUser, ViewerProfile } from "@/lib/auth/types";

import { fromDatabaseErrorCode } from "./errors";
import type { CurrentConnection, Partner } from "./types";

export function parseConnectionState(
  value: Json,
  viewer: AuthenticatedUser,
): CurrentConnection {
  const safeViewer = toViewerProfile(viewer);
  const record = unwrapRecord(value);
  if (!record) return { status: "NOT_CONNECTED", viewer: safeViewer };

  const errorCode = readString(record, "error_code", "errorCode");
  if (errorCode) {
    throw fromDatabaseErrorCode(
      errorCode,
      readSafeRetryAfter(record, "retry_after_seconds", "retryAfterSeconds"),
    );
  }

  const state = readString(record, "state", "status")?.toUpperCase();

  switch (state) {
    case "PENDING": {
      const code = readString(record, "code");
      const expiresAt = readString(record, "expires_at", "expiresAt");
      if (!code || !expiresAt) throw malformedResponse();
      return {
        status: "PENDING",
        viewer: safeViewer,
        code,
        expiresAt,
        createdAt: readString(record, "created_at", "createdAt"),
      };
    }
    case "CONNECTED":
      return {
        status: "CONNECTED",
        viewer: safeViewer,
        connectedAt: readString(record, "connected_at", "connectedAt"),
        partner: parsePartner(record.partner),
      };
    case "EXPIRED":
      return {
        status: "EXPIRED",
        viewer: safeViewer,
        code: readString(record, "code"),
        expiresAt: readString(record, "expires_at", "expiresAt"),
      };
    case "CANCELLED":
      return {
        status: "CANCELLED",
        viewer: safeViewer,
        code: readString(record, "code"),
      };
    case "DISCONNECTED":
      return {
        status: "DISCONNECTED",
        viewer: safeViewer,
        disconnectedAt: readString(
          record,
          "disconnected_at",
          "disconnectedAt",
          "updated_at",
        ),
      };
    case "NOT_CONNECTED":
    case "":
    case undefined:
      return { status: "NOT_CONNECTED", viewer: safeViewer };
    default:
      throw malformedResponse();
  }
}

function toViewerProfile(user: AuthenticatedUser): ViewerProfile {
  return {
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

function parsePartner(value: Json | undefined): Partner {
  const record = unwrapRecord(value);
  if (!record) {
    return { name: "Your partner", avatarUrl: null };
  }

  return {
    name:
      readString(record, "display_name", "full_name", "name") ?? "Your partner",
    avatarUrl: safeImageUrl(
      readString(record, "avatar_url", "avatarUrl", "picture"),
    ),
  };
}

function unwrapRecord(value: Json | undefined): Record<string, Json | undefined> | null {
  if (Array.isArray(value)) return unwrapRecord(value[0]);
  if (typeof value !== "object" || value === null) return null;
  return value;
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

function safeImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function readSafeRetryAfter(
  record: Record<string, Json | undefined>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= 86_400
    ) {
      return value;
    }
  }
  return undefined;
}

function malformedResponse(): Error {
  return new Error("Malformed connection RPC response.");
}
