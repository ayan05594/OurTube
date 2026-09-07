import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/app/components/brand";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How privacy works in your two-person OurTube space.",
};

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <header className="settings-topbar">
        <Brand compact />
        <Link className="text-link" href="/"><span aria-hidden="true">←</span>Back home</Link>
      </header>
      <article className="privacy-copy">
        <p className="eyebrow">Private by design</p>
        <h1>Your shared space belongs to the two of you.</h1>
        <p className="privacy-lede">OurTube is designed around a single private connection, not a public social graph.</p>
        <section><h2>One connection, two people</h2><p>A secure, expiring code lets one other person join. Used, cancelled, or expired codes cannot be reused, and a third person cannot enter a connected space.</p></section>
        <section><h2>Connection-scoped content</h2><p>Your chat, shared videos, Shorts, reactions, and shared favorites are tied to your connection. Access is checked for every signed-in request.</p></section>
        <section>
          <h2>YouTube search and playback</h2>
          <p>
            OurTube uses YouTube API Services so you can search YouTube without
            leaving your private space. When you connect the feature, OurTube
            requests read-only YouTube permission. Your search query is sent to
            YouTube and matching API data is returned to the app. Search results
            and their thumbnails are delivered from YouTube to your browser and
            are not added to your shared space automatically; only the selected
            video ID, canonical YouTube URL, and title are stored when you
            choose to share a video.
          </p>
          <p>
            The Google provider access token used for search is short-lived. It
            stays in a secure, HTTP-only server cookie and is not stored in the
            database or exposed to client-side JavaScript. You can remove
            OurTube&apos;s access at any time from your Google Account&apos;s{" "}
            <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">
              third-party connections
            </a>.
          </p>
          <p>
            When you choose to play a shared video, your browser connects to
            YouTube using its privacy-enhanced player. YouTube may receive your
            site origin and playback information. YouTube features are governed
            by the{" "}
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">
              YouTube Terms of Service
            </a>{" "}
            and Google&apos;s{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>.
          </p>
        </section>
        <section><h2>A careful goodbye</h2><p>Disconnecting closes access to the shared space without immediately deleting its history. This keeps future recovery choices open while preventing continued access.</p></section>
        <p className="privacy-contact">Questions about your data? Contact the OurTube team responsible for this deployment.</p>
      </article>
    </main>
  );
}
