import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/app/components/brand";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using your private OurTube space.",
};

export default function TermsPage() {
  return (
    <main className="privacy-page">
      <header className="settings-topbar">
        <Brand compact />
        <Link className="text-link" href="/"><span aria-hidden="true">←</span>Back home</Link>
      </header>
      <article className="privacy-copy">
        <p className="eyebrow">OurTube terms</p>
        <h1>A private space comes with a few shared responsibilities.</h1>
        <p className="privacy-lede">
          By using OurTube, you agree to these terms and to use the service
          lawfully and respectfully.
        </p>

        <section>
          <h2>Your account and connection</h2>
          <p>
            You are responsible for your Google account and for sharing a
            connection code only with the person you intend to invite. Do not
            attempt to enter another pair&apos;s space or bypass access controls.
          </p>
        </section>

        <section>
          <h2>Personal sharing</h2>
          <p>
            OurTube is for lawful, personal sharing between two people. Do not
            use it to harass others, distribute unlawful material, infringe
            intellectual-property rights, interfere with the service, or abuse
            YouTube or Google services.
          </p>
        </section>

        <section>
          <h2>YouTube services</h2>
          <p>
            By using OurTube&apos;s YouTube search or playback features, you also
            agree to the{" "}
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">
              YouTube Terms of Service
            </a>.
            OurTube is not affiliated with, endorsed by, or sponsored by
            YouTube or Google. YouTube and its licensors retain ownership of
            YouTube content, branding, and services; OurTube does not grant any
            rights in them.
          </p>
        </section>

        <section>
          <h2>Your content</h2>
          <p>
            You keep any rights you have in messages and notes you submit. You
            allow this deployment to process that content only as needed to
            provide and protect your private shared space.
          </p>
        </section>

        <section>
          <h2>Service availability</h2>
          <p>
            Features may change, pause, or stop, and third-party services may
            make some videos or searches unavailable. Access may be limited when
            needed to protect users, the service, or comply with law.
          </p>
        </section>

        <p className="privacy-contact">
          How OurTube handles data is described in the <Link href="/privacy">Privacy notice</Link>.
          Questions can be directed to the OurTube team responsible for this deployment.
        </p>
      </article>
    </main>
  );
}
