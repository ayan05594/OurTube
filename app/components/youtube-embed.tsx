"use client";

type YouTubeEmbedProps = {
  active: boolean;
  badge: string;
  className?: string;
  onPlay: () => void;
  title: string;
  variant: "video" | "short";
  videoId: string;
};

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function YouTubeEmbed({
  active,
  badge,
  className,
  onPlay,
  title,
  variant,
  videoId,
}: YouTubeEmbedProps) {
  const safeVideoId = YOUTUBE_VIDEO_ID.test(videoId) ? videoId : null;
  const classes = [
    "youtube-embed",
    `youtube-embed--${variant}`,
    className,
  ].filter(Boolean).join(" ");

  if (!safeVideoId) {
    return (
      <div className={classes}>
        <p className="youtube-embed__unavailable">This YouTube video is unavailable.</p>
      </div>
    );
  }

  if (active) {
    const embedUrl =
      `https://www.youtube-nocookie.com/embed/${encodeURIComponent(safeVideoId)}?autoplay=1&playsinline=1`;

    return (
      <div className={classes}>
        <iframe
          src={embedUrl}
          title={`YouTube player: ${title}`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className={classes}>
      <button
        className="youtube-embed__facade"
        type="button"
        onClick={onPlay}
        aria-label={`Play ${title} here`}
      >
        {variant === "video" ? (
          <>
            <span className="poster-kicker">{badge}</span>
            <span className="poster-shape" aria-hidden="true" />
            <span className="poster-play" aria-hidden="true">▶</span>
            <span className="poster-duration">Play here</span>
          </>
        ) : (
          <>
            <span className="short-card__index">{badge}</span>
            <span className="short-card__play" aria-hidden="true">▶</span>
            <span className="short-card__duration">Play here</span>
          </>
        )}
      </button>
    </div>
  );
}
