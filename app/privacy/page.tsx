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
        <section><h2>A careful goodbye</h2><p>Disconnecting closes access to the shared space without immediately deleting its history. This keeps future recovery choices open while preventing continued access.</p></section>
        <p className="privacy-contact">Questions about your data? Contact the OurTube team responsible for this deployment.</p>
      </article>
    </main>
  );
}
