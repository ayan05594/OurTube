import "server-only";

export const YOUTUBE_ACCESS_COOKIE = "ourtube-youtube-access";
export const YOUTUBE_OWNER_COOKIE = "ourtube-youtube-owner";
export const YOUTUBE_PENDING_COOKIE = "ourtube-youtube-pending";

const ACCESS_TOKEN_MAX_AGE_SECONDS = 3_300;
const PENDING_MAX_AGE_SECONDS = 10 * 60;

export function youtubeAccessCookieOptions(maxAge = ACCESS_TOKEN_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/youtube",
    maxAge,
  };
}

export function youtubePendingCookieOptions(maxAge = PENDING_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function createYouTubeOwnerBinding(
  userId: string,
  accessToken: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(accessToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(userId));
  return toBase64Url(new Uint8Array(signature));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
