export type MessageType = "text" | "video" | "short";
export type FavoriteVisibility = "private" | "shared";
export type ReactionEmoji = "👍" | "❤️" | "😂" | "😮" | "😢" | "🔥";

export type MessageAuthor = Readonly<{
  name: string;
  avatarUrl: string | null;
}>;

export type ReactionSummary = Readonly<{
  emoji: ReactionEmoji | string;
  count: number;
  reactedByViewer: boolean;
}>;

export type MessageMetadata = Readonly<
  Record<string, string | number | boolean | null>
>;

export type OurTubeMessage = Readonly<{
  id: string;
  type: MessageType;
  content: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  metadata: MessageMetadata;
  createdAt: string;
  updatedAt: string;
  isMine: boolean;
  sender: MessageAuthor;
  reactions: readonly ReactionSummary[];
}>;

export type SharedVideo = Readonly<{
  messageId: string;
  type: "video" | "short";
  youtubeVideoId: string;
  youtubeUrl: string;
  title: string | null;
  sharedAt: string;
  sharedByViewer: boolean;
}>;

export type Favorite = Readonly<{
  id: string;
  type: "video" | "short";
  visibility: FavoriteVisibility;
  youtubeVideoId: string;
  youtubeUrl: string;
  createdAt: string;
  createdByViewer: boolean;
}>;

export type ConnectedContent = Readonly<{
  messages: readonly OurTubeMessage[];
  sharedVideos: readonly SharedVideo[];
  favorites: readonly Favorite[];
}>;

export type ShareMediaInput = Readonly<{
  youtubeUrl: string;
  title?: string | null;
  note?: string | null;
}>;

export type ToggleReactionInput = Readonly<{
  messageId: string;
  emoji: ReactionEmoji;
}>;

export type ToggleFavoriteInput = Readonly<{
  youtubeUrl: string;
  type: "video" | "short";
  visibility: FavoriteVisibility;
}>;

export type SetFavoriteVisibilityInput = Readonly<{
  favoriteId: string;
  visibility: FavoriteVisibility;
}>;
