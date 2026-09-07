import type { PostgrestError } from "@supabase/supabase-js";

import { UnauthenticatedError } from "@/lib/auth/errors";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

import type { ActionError, ActionErrorCode } from "./types";

type SafeErrorDefinition = Readonly<{
  code: ActionErrorCode;
  message: string;
  status: number;
}>;

const DEFINITIONS: Record<ActionErrorCode, SafeErrorDefinition> = {
  UNAUTHENTICATED: {
    code: "UNAUTHENTICATED",
    message: "Please sign in to continue.",
    status: 401,
  },
  GOOGLE_AUTH_REQUIRED: {
    code: "GOOGLE_AUTH_REQUIRED",
    message: "Please sign in with Google to continue.",
    status: 403,
  },
  NOT_CONNECTED: {
    code: "NOT_CONNECTED",
    message: "Connect with your partner before using this feature.",
    status: 409,
  },
  INVALID_CODE_FORMAT: {
    code: "INVALID_CODE_FORMAT",
    message: "Enter an 8-character connection code.",
    status: 400,
  },
  CODE_NOT_FOUND: {
    code: "CODE_NOT_FOUND",
    message: "That connection code was not found.",
    status: 404,
  },
  CODE_EXPIRED: {
    code: "CODE_EXPIRED",
    message: "This connection code has expired.",
    status: 410,
  },
  CODE_INACTIVE: {
    code: "CODE_INACTIVE",
    message: "This connection code is no longer active.",
    status: 409,
  },
  CODE_ALREADY_USED: {
    code: "CODE_ALREADY_USED",
    message: "This connection code has already been used.",
    status: 409,
  },
  SELF_CONNECTION: {
    code: "SELF_CONNECTION",
    message: "You cannot join a connection you created.",
    status: 409,
  },
  CONNECTION_FULL: {
    code: "CONNECTION_FULL",
    message: "This private connection already has two people.",
    status: 409,
  },
  ALREADY_CONNECTED: {
    code: "ALREADY_CONNECTED",
    message: "You already have an active private connection.",
    status: 409,
  },
  PENDING_CONNECTION_EXISTS: {
    code: "PENDING_CONNECTION_EXISTS",
    message: "You already have a pending connection code.",
    status: 409,
  },
  NOT_CONNECTION_CREATOR: {
    code: "NOT_CONNECTION_CREATOR",
    message: "Only the person who generated this code can cancel it.",
    status: 403,
  },
  NO_PENDING_CONNECTION: {
    code: "NO_PENDING_CONNECTION",
    message: "There is no pending connection to cancel.",
    status: 404,
  },
  INVALID_INPUT: {
    code: "INVALID_INPUT",
    message: "Check the information you entered and try again.",
    status: 400,
  },
  NOT_FOUND: {
    code: "NOT_FOUND",
    message: "That item could not be found.",
    status: 404,
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    message: "You do not have access to that item.",
    status: 403,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "Too many requests. Please wait a moment and try again.",
    status: 429,
  },
  QUOTA_EXCEEDED: {
    code: "QUOTA_EXCEEDED",
    message: "This private space has reached its saved-content limit.",
    status: 409,
  },
  CONFIGURATION_ERROR: {
    code: "CONFIGURATION_ERROR",
    message: "OurTube is not connected to its data service yet.",
    status: 503,
  },
  SERVICE_UNAVAILABLE: {
    code: "SERVICE_UNAVAILABLE",
    message: "OurTube could not complete that request. Please try again.",
    status: 503,
  },
};

export class ConnectionServiceError extends Error {
  readonly name = "ConnectionServiceError";

  constructor(
    readonly definition: SafeErrorDefinition,
    readonly field?: string,
    readonly retryAfterSeconds?: number,
    readonly resource?: ActionError["resource"],
    readonly limit?: number,
  ) {
    super(definition.message);
  }
}

export function invalidInput(field?: string): ConnectionServiceError {
  return new ConnectionServiceError(DEFINITIONS.INVALID_INPUT, field);
}

export function invalidCode(): ConnectionServiceError {
  return new ConnectionServiceError(DEFINITIONS.INVALID_CODE_FORMAT, "code");
}

export function notConnected(): ConnectionServiceError {
  return new ConnectionServiceError(DEFINITIONS.NOT_CONNECTED);
}

export function fromPostgrestError(error: PostgrestError): ConnectionServiceError {
  const signature = [error.code, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  return fromDatabaseErrorCode(signature);
}

/** Maps stable codes returned as JSON when Postgres must commit side effects. */
export function fromDatabaseErrorCode(
  code: string,
  retryAfterSeconds?: number,
  resource?: ActionError["resource"],
  limit?: number,
): ConnectionServiceError {
  const signature = code.trim().toUpperCase();

  const mappings: Array<[RegExp, ActionErrorCode]> = [
    [/GOOGLE_AUTH_REQUIRED/, "GOOGLE_AUTH_REQUIRED"],
    [/AUTH_REQUIRED|AUTHENTICATION_REQUIRED|UNAUTHENTICATED/, "UNAUTHENTICATED"],
    [/PENDING_CONNECTION_EXISTS|ALREADY_HAS_PENDING/, "PENDING_CONNECTION_EXISTS"],
    [/ALREADY_CONNECTED|ALREADY_IN_ACTIVE_CONNECTION/, "ALREADY_CONNECTED"],
    [/CODE_NOT_FOUND|CONNECTION_CODE_NOT_FOUND/, "CODE_NOT_FOUND"],
    [/CODE_EXPIRED|CONNECTION_CODE_EXPIRED/, "CODE_EXPIRED"],
    [/CODE_ALREADY_USED|CONNECTION_CODE_USED/, "CODE_ALREADY_USED"],
    [/CODE_INACTIVE|CONNECTION_CODE_INACTIVE/, "CODE_INACTIVE"],
    [/SELF_CONNECTION|OWN_CONNECTION|OWN_CODE/, "SELF_CONNECTION"],
    [/CONNECTION_FULL|MEMBER_LIMIT/, "CONNECTION_FULL"],
    [/NOT_CONNECTION_CREATOR|ONLY_CREATOR/, "NOT_CONNECTION_CREATOR"],
    [/NO_PENDING_CONNECTION/, "NO_PENDING_CONNECTION"],
    [/NOT_CONNECTED|NO_ACTIVE_CONNECTION/, "NOT_CONNECTED"],
    [
      /INVALID_(INPUT|MESSAGE|MEDIA|REACTION|FAVORITE|VISIBILITY|TYPE|YOUTUBE)/,
      "INVALID_INPUT",
    ],
    [/CONTENT_TOO_LONG|INVALID_METADATA/, "INVALID_INPUT"],
    [/QUOTA_EXCEEDED/, "QUOTA_EXCEEDED"],
    [/RATE_LIMIT|TOO_MANY/, "RATE_LIMITED"],
    [/42501|ROW-LEVEL SECURITY|PERMISSION DENIED/, "FORBIDDEN"],
    [/PGRST116|NOT_FOUND/, "NOT_FOUND"],
  ];

  const mapped = mappings.find(([pattern]) => pattern.test(signature));
  return new ConnectionServiceError(
    DEFINITIONS[mapped?.[1] ?? "SERVICE_UNAVAILABLE"],
    undefined,
    retryAfterSeconds,
    resource,
    limit,
  );
}

export function toActionError(error: unknown): ActionError {
  if (error instanceof ConnectionServiceError) {
    return {
      code: error.definition.code,
      message: error.definition.message,
      ...(error.field ? { field: error.field } : {}),
      ...(error.retryAfterSeconds
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      ...(error.resource ? { resource: error.resource } : {}),
      ...(error.limit ? { limit: error.limit } : {}),
    };
  }
  if (error instanceof UnauthenticatedError) {
    return actionErrorFor(
      error.reason === "google_required"
        ? "GOOGLE_AUTH_REQUIRED"
        : "UNAUTHENTICATED",
    );
  }
  if (error instanceof SupabaseConfigurationError) {
    return actionErrorFor("CONFIGURATION_ERROR");
  }
  return actionErrorFor("SERVICE_UNAVAILABLE");
}

export function statusForError(error: unknown): number {
  if (error instanceof ConnectionServiceError) return error.definition.status;
  if (error instanceof UnauthenticatedError) {
    return DEFINITIONS[
      error.reason === "google_required"
        ? "GOOGLE_AUTH_REQUIRED"
        : "UNAUTHENTICATED"
    ].status;
  }
  if (error instanceof SupabaseConfigurationError) {
    return DEFINITIONS.CONFIGURATION_ERROR.status;
  }
  return DEFINITIONS.SERVICE_UNAVAILABLE.status;
}

function actionErrorFor(code: ActionErrorCode): ActionError {
  const definition = DEFINITIONS[code];
  return { code: definition.code, message: definition.message };
}
