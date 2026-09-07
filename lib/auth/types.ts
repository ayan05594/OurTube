export type ViewerProfile = Readonly<{
  email: string | null;
  name: string;
  avatarUrl: string | null;
}>;

export type AuthenticatedUser = ViewerProfile & Readonly<{ id: string }>;
