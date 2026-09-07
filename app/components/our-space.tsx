"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  sendTextMessage,
  shareShort,
  shareVideo,
  setFavoriteVisibility,
  toggleFavorite,
  toggleMessageReaction,
} from "@/app/actions/content";
import type { ActionResult, ConnectedViewer } from "@/lib/connections/types";
import { subscribeToConnectionChanges } from "@/lib/connections/realtime";
import type { ConnectedContent, OurTubeMessage, SharedVideo } from "@/lib/content/types";
import { subscribeToContentChanges } from "@/lib/content/realtime";
import { Brand } from "./brand";
import { UserAvatar } from "./user-avatar";

type SpaceTab = "videos" | "shorts" | "chat";
type ShareKind = "video" | "short" | null;

type OurSpaceProps = {
  connection: ConnectedViewer;
  initialContent: ConnectedContent;
};

const navItems: Array<{ id: SpaceTab; label: string; mobileLabel: string; symbol: string }> = [
  { id: "videos", label: "Our Videos", mobileLabel: "Videos", symbol: "▶" },
  { id: "shorts", label: "Shorts", mobileLabel: "Shorts", symbol: "▯" },
  { id: "chat", label: "Our Chat", mobileLabel: "Chat", symbol: "●" },
];

const palettes = ["sunset", "plum", "sage"] as const;
const shortPalettes = ["coral", "blue", "gold", "violet"] as const;

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function messageTitle(message: OurTubeMessage | undefined, video: SharedVideo) {
  const metadataTitle = message?.metadata.title;
  return video.title ?? (typeof metadataTitle === "string" ? metadataTitle : null) ??
    (video.type === "short" ? "A Short shared with you" : "A video shared with you");
}

export function OurSpace({ connection, initialContent }: OurSpaceProps) {
  const router = useRouter();
  const { viewer, partner, connectedAt } = connection;
  const [activeTab, setActiveTab] = useState<SpaceTab>("videos");
  const [content, setContent] = useState(initialContent);
  const [shareKind, setShareKind] = useState<ShareKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const leavingSpace = useRef(false);
  const panelId = useId();
  const firstName = viewer.name.split(" ")[0] || "there";
  const partnerFirstName = partner.name.split(" ")[0] || "your partner";

  const messagesById = useMemo(
    () => new Map(content.messages.map((message) => [message.id, message])),
    [content.messages],
  );
  const videos = content.sharedVideos.filter((item) => item.type === "video");
  const shorts = content.sharedVideos.filter((item) => item.type === "short");
  const partnershipDate = connectedAt
    ? `Together since ${new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(connectedAt))}`
    : "Your shared space";

  useEffect(() => subscribeToContentChanges(setContent), []);

  useEffect(
    () =>
      subscribeToConnectionChanges((latestConnection) => {
        if (latestConnection.status === "CONNECTED" || leavingSpace.current) return;
        leavingSpace.current = true;
        setContent({ messages: [], sharedVideos: [], favorites: [] });
        router.replace("/connect");
        router.refresh();
      }),
    [router],
  );

  function runMutation(
    operation: () => Promise<ActionResult<ConnectedContent>>,
    onSuccess?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await operation();
      if (result.ok) {
        setContent(result.data);
        setShareKind(null);
        onSuccess?.();
      } else {
        setError(result.error.message);
      }
    });
  }

  function addMedia(event: FormEvent<HTMLFormElement>, kind: "video" | "short") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    runMutation(() => (kind === "video" ? shareVideo(form) : shareShort(form)));
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = String(form.get("message") ?? "").trim();
    if (!message) return;
    const composer = event.currentTarget;
    runMutation(() => sendTextMessage(message), () => composer.reset());
  }

  function toggleSaved(video: SharedVideo, visibility: "private" | "shared") {
    runMutation(() =>
      toggleFavorite({
        youtubeUrl: video.youtubeUrl,
        type: video.type,
        visibility,
      }),
    );
  }

  function changeVisibility(favoriteId: string, visibility: "private" | "shared") {
    runMutation(() => setFavoriteVisibility({ favoriteId, visibility }));
  }

  function react(messageId: string) {
    runMutation(() => toggleMessageReaction({ messageId, emoji: "❤️" }));
  }

  return (
    <main className="space-page">
      <header className="space-topbar">
        <Brand compact />
        <div className="space-topbar__right">
          <span className="presence-pill"><span className="presence-dot" aria-hidden="true" />Connected privately</span>
          <Link className="icon-button" href="/settings" aria-label="Open settings"><span aria-hidden="true">⌁</span></Link>
        </div>
      </header>
      <div className="space-layout">
        <aside className="space-sidebar" aria-label="Shared space navigation">
          <div className="connection-mini-card">
            <div className="avatar-pair" aria-hidden="true"><UserAvatar name={viewer.name} imageUrl={viewer.avatarUrl} size="small" /><UserAvatar name={partner.name} imageUrl={partner.avatarUrl} size="small" /></div>
            <div><strong>You &amp; {partnerFirstName}</strong><span>{partnershipDate}</span></div>
          </div>
          <nav className="space-nav">
            {navItems.map((item) => (
              <button key={item.id} className={activeTab === item.id ? "is-active" : undefined} type="button" onClick={() => setActiveTab(item.id)} aria-current={activeTab === item.id ? "page" : undefined} aria-controls={`${panelId}-${item.id}`}>
                <span className={`nav-symbol nav-symbol--${item.id}`} aria-hidden="true">{item.symbol}</span>{item.label}
              </button>
            ))}
          </nav>
          <p className="sidebar-note"><span aria-hidden="true">♥</span>Only the two of you can see what is shared here.</p>
        </aside>
        <section className="space-content" aria-live="polite">
          {activeTab === "videos" && (
            <div id={`${panelId}-videos`} role="tabpanel" className="tab-panel">
              <div className="content-heading">
                <div><p className="eyebrow">Your shared queue</p><h1>Good evening, {firstName}.</h1><p>A little corner for everything you want to watch together.</p></div>
                <button className="primary-button primary-button--small" type="button" onClick={() => setShareKind(shareKind === "video" ? null : "video")} aria-expanded={shareKind === "video"} aria-controls="share-video-panel"><span aria-hidden="true">＋</span>Share a video</button>
              </div>
              {shareKind === "video" && (
                <form className="share-composer" id="share-video-panel" onSubmit={(event) => addMedia(event, "video")}>
                  <div><label htmlFor="youtube-url">Paste a YouTube link</label><p>It will appear here for {partnerFirstName}.</p></div>
                  <div className="share-composer__fields"><input id="youtube-url" name="youtubeUrl" type="url" inputMode="url" placeholder="https://youtube.com/watch?v=…" required /><button className="primary-button primary-button--small" type="submit" disabled={isPending}>Add to our space</button></div>
                </form>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              {videos.length > 0 ? (
                <>
                  <div className="section-label"><h2>Recently shared</h2><span>{videos.length} {videos.length === 1 ? "video" : "videos"}</span></div>
                  <div className="video-grid">
                    {videos.map((video, index) => {
                      const message = messagesById.get(video.messageId);
                      const viewerFavorite = content.favorites.find((item) => item.youtubeUrl === video.youtubeUrl && item.createdByViewer);
                      const partnerFavorite = content.favorites.find((item) => item.youtubeUrl === video.youtubeUrl && !item.createdByViewer && item.visibility === "shared");
                      const title = messageTitle(message, video);
                      return (
                        <article className="video-card" key={video.messageId}>
                          <a className={`video-poster video-poster--${palettes[index % palettes.length]}`} href={video.youtubeUrl} target="_blank" rel="noreferrer" aria-label={`Watch ${title} on YouTube`}>
                            <span className="poster-kicker">{index === 0 ? "Latest for us" : "YouTube"}</span><span className="poster-shape" aria-hidden="true" /><span className="poster-play" aria-hidden="true">▶</span><span className="poster-duration">Watch</span>
                          </a>
                          <div className="video-card__body">
                            <div><p className="video-source">Shared {formatWhen(video.sharedAt)}</p><h3>{title}</h3></div>
                            <details className="favorite-menu">
                              <summary className={`love-button${viewerFavorite || partnerFavorite ? " is-loved" : ""}`} aria-label={viewerFavorite ? `Saved ${viewerFavorite.visibility}` : partnerFavorite ? "Your partner shared this favorite" : "Choose how to save this video"}><span aria-hidden="true">♥</span></summary>
                              <div>
                                {viewerFavorite ? (
                                  <><strong>Saved {viewerFavorite.visibility === "private" ? "for you" : "together"}</strong><button type="button" onClick={() => changeVisibility(viewerFavorite.id, viewerFavorite.visibility === "private" ? "shared" : "private")} disabled={isPending}>{viewerFavorite.visibility === "private" ? "Share this favorite" : "Make private"}</button><button type="button" onClick={() => toggleSaved(video, viewerFavorite.visibility)} disabled={isPending}>Remove favorite</button></>
                                ) : (
                                  <>{partnerFavorite ? <span className="favorite-context">{partnerFirstName} saved this together</span> : <strong>Save this video</strong>}<button type="button" onClick={() => toggleSaved(video, "private")} disabled={isPending}>Save for me</button><button type="button" onClick={() => toggleSaved(video, "shared")} disabled={isPending}>Share favorite</button></>
                                )}
                              </div>
                            </details>
                          </div>
                          {message?.content && <p className="video-note">“{message.content}”</p>}
                          <p className="video-meta">Shared by {video.sharedByViewer ? "you" : partnerFirstName}</p>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="empty-state"><div><span className="empty-state__icon" aria-hidden="true">▶</span><h2>Your first watch starts here.</h2><p>Share a YouTube link and it will stay in one quiet queue for you and {partnerFirstName}.</p><button className="primary-button primary-button--small empty-state__button" type="button" onClick={() => setShareKind("video")}>Share our first video</button></div></div>
              )}
            </div>
          )}
          {activeTab === "shorts" && (
            <div id={`${panelId}-shorts`} role="tabpanel" className="tab-panel">
              <div className="content-heading">
                <div><p className="eyebrow">Quick little finds</p><h1>Shorts for us.</h1><p>Tiny videos that were too good not to send.</p></div>
                <button className="primary-button primary-button--small" type="button" onClick={() => setShareKind(shareKind === "short" ? null : "short")} aria-expanded={shareKind === "short"} aria-controls="share-short-panel"><span aria-hidden="true">＋</span>Share a Short</button>
              </div>
              {shareKind === "short" && (
                <form className="share-composer" id="share-short-panel" onSubmit={(event) => addMedia(event, "short")}>
                  <div><label htmlFor="short-url">Paste a YouTube Shorts link</label><p>A quick find for {partnerFirstName}.</p></div>
                  <div className="share-composer__fields"><input id="short-url" name="youtubeUrl" type="url" inputMode="url" placeholder="https://youtube.com/shorts/…" required /><button className="primary-button primary-button--small" type="submit" disabled={isPending}>Share this Short</button></div>
                </form>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              {shorts.length > 0 ? (
                <div className="shorts-grid">
                  {shorts.map((short, index) => {
                    const message = messagesById.get(short.messageId);
                    const title = messageTitle(message, short);
                    const viewerFavorite = content.favorites.find((item) => item.youtubeUrl === short.youtubeUrl && item.createdByViewer);
                    const partnerFavorite = content.favorites.find((item) => item.youtubeUrl === short.youtubeUrl && !item.createdByViewer && item.visibility === "shared");
                    return (
                      <article className={`short-card short-card--${shortPalettes[index % shortPalettes.length]}`} key={short.messageId}>
                        <a href={short.youtubeUrl} target="_blank" rel="noreferrer" aria-label={`Watch ${title} on YouTube`}><span className="short-card__index">{String(index + 1).padStart(2, "0")}</span><span className="short-card__play" aria-hidden="true">▶</span><span className="short-card__duration">Watch</span></a>
                        <div className="short-card__body">
                          <div><h2>{title}</h2><p>Shared by {short.sharedByViewer ? "you" : partnerFirstName} · {formatWhen(short.sharedAt)}</p></div>
                          <details className="favorite-menu favorite-menu--short">
                            <summary className={`love-button${viewerFavorite || partnerFavorite ? " is-loved" : ""}`} aria-label={viewerFavorite ? `Saved ${viewerFavorite.visibility}` : partnerFavorite ? "Your partner shared this favorite" : "Choose how to save this Short"}><span aria-hidden="true">♥</span></summary>
                            <div>
                              {viewerFavorite ? (
                                <><strong>Saved {viewerFavorite.visibility === "private" ? "for you" : "together"}</strong><button type="button" onClick={() => changeVisibility(viewerFavorite.id, viewerFavorite.visibility === "private" ? "shared" : "private")} disabled={isPending}>{viewerFavorite.visibility === "private" ? "Share this favorite" : "Make private"}</button><button type="button" onClick={() => toggleSaved(short, viewerFavorite.visibility)} disabled={isPending}>Remove favorite</button></>
                              ) : (
                                <>{partnerFavorite ? <span className="favorite-context">{partnerFirstName} saved this together</span> : <strong>Save this Short</strong>}<button type="button" onClick={() => toggleSaved(short, "private")} disabled={isPending}>Save for me</button><button type="button" onClick={() => toggleSaved(short, "shared")} disabled={isPending}>Share favorite</button></>
                              )}
                            </div>
                          </details>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state"><div><span className="empty-state__icon" aria-hidden="true">▯</span><h2>No Shorts here yet.</h2><p>When one makes you laugh, wonder, or think of {partnerFirstName}, give it a home here.</p><button className="primary-button primary-button--small empty-state__button" type="button" onClick={() => setShareKind("short")}>Share our first Short</button></div></div>
              )}
            </div>
          )}
          {activeTab === "chat" && (
            <div id={`${panelId}-chat`} role="tabpanel" className="tab-panel chat-panel">
              <div className="chat-heading">
                <div className="avatar-with-status"><UserAvatar name={partner.name} imageUrl={partner.avatarUrl} /><span aria-hidden="true" /></div>
                <div><h1>Our Chat</h1><p>Your private conversation with {partnerFirstName}</p></div>
              </div>
              <div className="message-list" aria-label={`Conversation with ${partner.name}`}>
                {content.messages.length > 0 ? <p className="chat-day">Your shared conversation</p> : null}
                {content.messages.length === 0 && (
                  <div className="empty-state empty-state--chat"><div><span className="empty-state__icon" aria-hidden="true">●</span><h2>Say the first hello.</h2><p>This is your private thread with {partnerFirstName}. Share a thought, a video, or the thing that made you smile today.</p></div></div>
                )}
                {content.messages.map((message) => {
                  if (message.type !== "text" && message.youtubeUrl) {
                    const title = typeof message.metadata.title === "string" ? message.metadata.title : message.type === "short" ? "A Short shared in your chat" : "A video shared in your chat";
                    return (
                      <div className={`chat-media-row${message.isMine ? " chat-media-row--mine" : ""}`} key={message.id}>
                        <a className="shared-chat-card" href={message.youtubeUrl} target="_blank" rel="noreferrer">
                          <div className="shared-chat-card__poster" aria-hidden="true"><span>▶</span></div>
                          <div><span>Shared {message.type}</span><strong>{title}</strong><p>{formatWhen(message.createdAt)}</p></div>
                        </a>
                        {message.content && <p className="media-message-note">“{message.content}”</p>}
                      </div>
                    );
                  }

                  const heart = message.reactions.find((item) => item.emoji.includes("❤"));
                  return (
                    <div className={`message-row message-row--${message.isMine ? "viewer" : "partner"}`} key={message.id}>
                      {!message.isMine && <UserAvatar name={message.sender.name} imageUrl={message.sender.avatarUrl} size="small" />}
                      <div><p>{message.content}</p><div className="message-meta"><time dateTime={message.createdAt}>{formatWhen(message.createdAt)}</time><button type="button" className={heart?.reactedByViewer ? "is-reacted" : undefined} onClick={() => react(message.id)} disabled={isPending} aria-label={heart?.reactedByViewer ? "Remove heart reaction" : "Add heart reaction"} aria-pressed={heart?.reactedByViewer}><span aria-hidden="true">♥</span>{heart?.count ? <i>{heart.count}</i> : null}</button></div></div>
                    </div>
                  );
                })}
              </div>
              {error && <p className="chat-error form-error" role="alert">{error}</p>}
              <form className="message-composer" onSubmit={sendMessage}>
                <button type="button" onClick={() => { setActiveTab("videos"); setShareKind("video"); }} aria-label="Share a video"><span aria-hidden="true">＋</span></button>
                <label className="sr-only" htmlFor="chat-message">Message {partner.name}</label>
                <input id="chat-message" name="message" type="text" autoComplete="off" placeholder={`Message ${partnerFirstName}…`} disabled={isPending} />
                <button className="send-button" type="submit" aria-label="Send message" disabled={isPending}><span aria-hidden="true">↑</span></button>
              </form>
            </div>
          )}
        </section>
      </div>
      <nav className="mobile-tabbar" aria-label="Shared space navigation">
        {navItems.map((item) => (
          <button key={item.id} className={activeTab === item.id ? "is-active" : undefined} type="button" onClick={() => setActiveTab(item.id)} aria-current={activeTab === item.id ? "page" : undefined}>
            <span className={`nav-symbol nav-symbol--${item.id}`} aria-hidden="true">{item.symbol}</span><span>{item.mobileLabel}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}
