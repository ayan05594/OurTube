export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ConnectionRpcSnapshot = {
  state:
    | "NOT_CONNECTED"
    | "PENDING"
    | "CONNECTED"
    | "EXPIRED"
    | "CANCELLED"
    | "DISCONNECTED";
  status:
    | "pending"
    | "connected"
    | "expired"
    | "cancelled"
    | "disconnected"
    | null;
  code?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
  connected_at?: string | null;
  disconnected_at?: string | null;
  partner?: {
    display_name: string | null;
    name: string | null;
    avatar_url: string | null;
  } | null;
};

export type ConnectionRpcErrorResult = {
  state: "ERROR";
  status: "error";
  error_code:
    | "RATE_LIMITED"
    | "CODE_NOT_FOUND"
    | "SELF_CONNECTION"
    | "CODE_ALREADY_USED"
    | "CODE_INACTIVE"
    | "CONNECTION_FULL"
    | "PENDING_CONNECTION_EXISTS"
    | "ALREADY_CONNECTED";
  retry_after_seconds?: number;
};

export type ConnectionRpcResult =
  | ConnectionRpcSnapshot
  | ConnectionRpcErrorResult;

export type ConnectedContentRpcResult = {
  messages: Array<{
    id: string;
    type: "text" | "video" | "short";
    content: string | null;
    youtube_video_id: string | null;
    youtube_url: string | null;
    metadata: Json;
    created_at: string;
    updated_at: string;
    is_mine: boolean;
    sender: {
      display_name: string | null;
      avatar_url: string | null;
    } | null;
    reactions: Array<{
      reaction: string;
      count: number;
      reacted_by_viewer: boolean;
    }>;
  }>;
  favorites: Array<{
    id: string;
    type: "video" | "short";
    visibility: "private" | "shared";
    youtube_video_id: string;
    youtube_url: string;
    created_at: string;
    created_by_viewer: boolean;
  }>;
};

export type MessageRpcResult = ConnectedContentRpcResult["messages"][number];

export type ContentMutationRpcErrorResult =
  | {
      state: "ERROR";
      status: "error";
      error_code: "RATE_LIMITED";
      retry_after_seconds: number;
    }
  | {
      state: "ERROR";
      status: "error";
      error_code: "QUOTA_EXCEEDED";
      resource: "messages" | "message_reactions" | "favorites";
      limit: number;
    }
  | {
      state: "ERROR";
      status: "error";
      error_code: "MESSAGE_NOT_FOUND" | "FAVORITE_NOT_FOUND";
    };

export type ReactionMutationRpcResult = {
  action: "added" | "updated" | "removed";
  id: string;
  message_id: string;
  reaction: string;
};

export type FavoriteMutationRpcResult =
  ConnectedContentRpcResult["favorites"][number] & {
    action: "added" | "updated" | "removed";
  };

/**
 * The integration layer intentionally models the RPC boundary only. Regenerate
 * this type from Supabase after applying schema changes if direct table queries
 * are added later.
 */
export type Database = {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      cancel_connection: {
        Args: Record<PropertyKey, never>;
        Returns: ConnectionRpcResult;
      };
      disconnect_connection: {
        Args: Record<PropertyKey, never>;
        Returns: ConnectionRpcResult;
      };
      generate_connection_code: {
        Args: Record<PropertyKey, never>;
        Returns: ConnectionRpcResult;
      };
      get_current_connection: {
        Args: Record<PropertyKey, never>;
        Returns: ConnectionRpcResult;
      };
      get_connected_content: {
        Args: Record<PropertyKey, never>;
        Returns: ConnectedContentRpcResult;
      };
      join_connection_by_code: {
        Args: { p_code: string };
        Returns: ConnectionRpcResult;
      };
      send_message: {
        Args: {
          p_type: string;
          p_content: string | null;
          p_youtube_video_id: string | null;
          p_youtube_url: string | null;
          p_metadata: Json;
        };
        Returns: MessageRpcResult | ContentMutationRpcErrorResult;
      };
      set_favorite_visibility: {
        Args: { p_favorite_id: string; p_visibility: string };
        Returns: FavoriteMutationRpcResult | ContentMutationRpcErrorResult;
      };
      toggle_favorite: {
        Args: {
          p_youtube_video_id: string;
          p_youtube_url: string;
          p_type: string;
          p_visibility: string;
        };
        Returns: FavoriteMutationRpcResult | ContentMutationRpcErrorResult;
      };
      toggle_message_reaction: {
        Args: { p_message_id: string; p_reaction: string };
        Returns: ReactionMutationRpcResult | ContentMutationRpcErrorResult;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
