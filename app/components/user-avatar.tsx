type UserAvatarProps = {
  name: string;
  imageUrl?: string | null;
  size?: "small" | "medium" | "large";
  muted?: boolean;
};

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "Y";
}

export function UserAvatar({
  name,
  imageUrl,
  size = "medium",
  muted = false,
}: UserAvatarProps) {
  return (
    <span
      className={`user-avatar user-avatar--${size}${muted ? " user-avatar--muted" : ""}`}
      title={name}
      aria-label={name}
    >
      {imageUrl ? (
        // Auth-provider images are dynamic and intentionally rendered without optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" src={imageUrl} referrerPolicy="no-referrer" />
      ) : (
        <span aria-hidden="true">{initialsFor(name)}</span>
      )}
    </span>
  );
}
