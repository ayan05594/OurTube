import type { ViewerProfile } from "@/lib/auth/types";

export type ConnectionStatus =
  | "NOT_CONNECTED"
  | "PENDING"
  | "CONNECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "DISCONNECTED";

export type Partner = Readonly<{
  name: string;
  avatarUrl: string | null;
}>;

type ViewerState = Readonly<{ viewer: ViewerProfile }>;

export type CurrentConnection =
  | (ViewerState & { status: "NOT_CONNECTED" })
  | (ViewerState & {
      status: "PENDING";
      code: string;
      expiresAt: string;
      createdAt: string | null;
    })
  | (ViewerState & {
      status: "CONNECTED";
      connectedAt: string | null;
      partner: Partner;
    })
  | (ViewerState & {
      status: "EXPIRED";
      code: string | null;
      expiresAt: string | null;
    })
  | (ViewerState & {
      status: "CANCELLED";
      code: string | null;
    })
  | (ViewerState & {
      status: "DISCONNECTED";
      disconnectedAt: string | null;
    });

export type ConnectedViewer = Extract<CurrentConnection, { status: "CONNECTED" }>;

export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "GOOGLE_AUTH_REQUIRED"
  | "NOT_CONNECTED"
  | "INVALID_CODE_FORMAT"
  | "CODE_NOT_FOUND"
  | "CODE_EXPIRED"
  | "CODE_INACTIVE"
  | "CODE_ALREADY_USED"
  | "SELF_CONNECTION"
  | "CONNECTION_FULL"
  | "ALREADY_CONNECTED"
  | "PENDING_CONNECTION_EXISTS"
  | "NOT_CONNECTION_CREATOR"
  | "NO_PENDING_CONNECTION"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "CONFIGURATION_ERROR"
  | "SERVICE_UNAVAILABLE";

export type ActionError = Readonly<{
  code: ActionErrorCode;
  message: string;
  field?: string;
  retryAfterSeconds?: number;
  resource?: "messages" | "message_reactions" | "favorites";
  limit?: number;
}>;

export type ActionResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: ActionError }>;
