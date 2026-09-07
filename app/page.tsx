import Link from "next/link";
import { redirect } from "next/navigation";
import { signInWithGoogle } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getCurrentConnection } from "@/lib/connections/queries";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Brand } from "./components/brand";
import { GoogleSignInButton } from "./components/google-sign-in-button";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: HomeProps) {
  const params = (await searchParams) ?? {};
  const configured = isSupabaseConfigured();
  const viewer = configured ? await getCurrentUser() : null;

  if (viewer) {
    const connection = await getCurrentConnection();
    redirect(connection.status === "CONNECTED" ? "/our-space" : "/connect");
  }

  const authError = Array.isArray(params.authError) ? params.authError[0] : params.authError;
  const authMessage = !configured
    ? "Our private sign-in is not configured yet. Add the Supabase public settings to continue."
    : authError
      ? "We couldn’t complete Google sign-in. Please try once more."
      : null;

  return (
    <main className="landing-page">
      <div className="landing-glow landing-glow--one" aria-hidden="true" />
      <div className="landing-glow landing-glow--two" aria-hidden="true" />
      <header className="landing-header">
        <Brand />
        <span className="for-two-pill"><span aria-hidden="true">♥</span>Made for two</span>
      </header>
      <section className="landing-hero">
        <div className="landing-copy">
          <div className="landing-eyebrow"><span className="eyebrow-avatars" aria-hidden="true"><i>A</i><i>M</i></span>One private space, together</div>
          <h1>The videos you love,<em> kept between you two.</em></h1>
          <p className="landing-lede">Share YouTube videos, swap Shorts, and talk about every little thing — in a warm, private space made for you and your person.</p>
          <form action={signInWithGoogle} className="sign-in-form"><GoogleSignInButton /></form>
          {authMessage && <p className="landing-alert" role="alert">{authMessage}</p>}
          <p className="sign-in-note"><span aria-hidden="true">●</span>Your space is invitation-only. No public profiles, ever.</p>
          <div className="landing-proof" aria-label="OurTube qualities">
            <div><strong>Just two</strong><span>No feeds or followers</span></div>
            <div><strong>One code</strong><span>A private invitation</span></div>
            <div><strong>Your pace</strong><span>Watch whenever you like</span></div>
          </div>
        </div>
        <div className="landing-preview" aria-label="Preview of a private OurTube space">
          <div className="preview-orbit preview-orbit--top" aria-hidden="true">♥</div>
          <div className="preview-orbit preview-orbit--bottom" aria-hidden="true">▶</div>
          <div className="preview-window">
            <div className="preview-window__topbar"><div><span className="preview-heart" aria-hidden="true">♥</span><strong>Our evening queue</strong></div><span className="preview-presence"><i /> Your partner is here</span></div>
            <div className="preview-feature">
              <div className="preview-feature__art" aria-hidden="true"><span className="preview-sun" /><span className="preview-hill preview-hill--one" /><span className="preview-hill preview-hill--two" /><span className="preview-play">▶</span><small>8:42</small></div>
              <div className="preview-feature__copy"><span>Shared with you</span><h2>Why quiet mornings feel like a superpower</h2><p>“This made me think of our Sunday walks.”</p><div><span className="mini-avatar" aria-hidden="true">P</span><small>Your partner · 12 min ago</small><i className="preview-reaction" aria-hidden="true">♥</i></div></div>
            </div>
            <div className="preview-lower">
              <div className="preview-queue"><div className="queue-art"><span>▶</span></div><div><small>Up next</small><strong>Spicy garlic noodles</strong><span>12:06 · Sunday Table</span></div></div>
              <div className="preview-message"><div className="mini-avatar" aria-hidden="true">P</div><div><span>Your partner</span><p>Saving this for Friday night ♥</p></div></div>
            </div>
          </div>
          <div className="floating-note floating-note--share" aria-hidden="true"><span>↗</span><p><strong>Shared privately</strong><small>Only you two can see it</small></p></div>
          <div className="floating-note floating-note--reaction" aria-hidden="true"><span>♥</span><p><strong>New reaction</strong><small>“This is so us”</small></p></div>
        </div>
      </section>
      <footer className="landing-footer"><p>OurTube <span aria-hidden="true">♥</span> a quieter place to share</p><nav aria-label="Footer"><Link href="/privacy">Privacy</Link></nav></footer>
    </main>
  );
}
