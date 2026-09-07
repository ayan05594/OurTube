"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { disconnectCurrentConnection } from "@/app/actions/connections";
import { signOut } from "@/app/actions/auth";
import { subscribeToConnectionChanges } from "@/lib/connections/realtime";
import { Brand } from "./brand";
import { UserAvatar } from "./user-avatar";

type SettingsViewProps = {
  viewerName: string;
  viewerEmail: string;
  viewerAvatarUrl?: string | null;
  partnerName: string;
  partnerAvatarUrl?: string | null;
  connectedAt?: string | null;
};

export function SettingsView({
  viewerName,
  viewerEmail,
  viewerAvatarUrl,
  partnerName,
  partnerAvatarUrl,
  connectedAt,
}: SettingsViewProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const disconnectButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const leavingSettings = useRef(false);

  const connectedLabel = (() => {
    if (!connectedAt) return "Connected in your private space";
    const date = new Date(connectedAt);
    if (Number.isNaN(date.getTime())) return "Connected in your private space";
    return `Connected ${new Intl.DateTimeFormat("en", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date)}`;
  })();

  useEffect(
    () =>
      subscribeToConnectionChanges((connection) => {
        if (connection.status === "CONNECTED" || leavingSettings.current) return;
        leavingSettings.current = true;
        router.replace("/connect");
        router.refresh();
      }),
    [router],
  );

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const result = await disconnectCurrentConnection();
      if (result.ok) {
        leavingSettings.current = true;
        router.replace("/connect");
        router.refresh();
        return;
      }

      setError(result.error.message);
    });
  }

  function openConfirmation() {
    setError(null);
    setConfirming(true);
  }

  function closeConfirmation() {
    if (isPending) return;
    setConfirming(false);
    window.requestAnimationFrame(() => disconnectButton.current?.focus());
  }

  function keepFocusInDialog(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = dialog.current?.querySelectorAll<HTMLButtonElement>(
      "button:not([disabled])",
    );
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <main className="settings-page">
      <header className="settings-topbar">
        <Brand compact />
        <Link className="text-link" href="/our-space">
          <span aria-hidden="true">←</span>
          Back to our space
        </Link>
      </header>

      <div className="settings-wrap">
        <div className="settings-heading">
          <p className="eyebrow">Your private space</p>
          <h1>Settings</h1>
          <p>Manage the space that belongs to just the two of you.</p>
        </div>

        <section className="settings-section" aria-labelledby="connection-heading">
          <div className="settings-section__heading">
            <div>
              <h2 id="connection-heading">Your Connection</h2>
              <p>{connectedLabel}</p>
            </div>
            <span className="secure-badge">
              <span className="secure-badge__dot" aria-hidden="true" />
              Private
            </span>
          </div>

          <div className="connection-story">
            <div className="connection-person">
              <UserAvatar name={viewerName} imageUrl={viewerAvatarUrl} size="large" />
              <div>
                <strong>{viewerName}</strong>
                <span>{viewerEmail}</span>
              </div>
            </div>

            <div className="connection-line" aria-hidden="true">
              <span />
              <b>♥</b>
              <span />
            </div>

            <div className="connection-person connection-person--partner">
              <UserAvatar name={partnerName} imageUrl={partnerAvatarUrl} size="large" />
              <div>
                <strong>{partnerName}</strong>
                <span>Your partner</span>
              </div>
            </div>
          </div>

          <div className="connection-detail-grid">
            <div>
              <span className="detail-symbol" aria-hidden="true">◉</span>
              <p>
                <strong>Only you two</strong>
                <span>No followers, public profile, or outside viewers.</span>
              </p>
            </div>
            <div>
              <span className="detail-symbol" aria-hidden="true">◇</span>
              <p>
                <strong>Your shared history</strong>
                <span>Videos, Shorts, reactions, and chat stay in this space.</span>
              </p>
            </div>
          </div>
        </section>

        <section className="danger-section" aria-labelledby="disconnect-heading">
          <div>
            <h2 id="disconnect-heading">Leave this connection</h2>
            <p>
              Disconnecting closes this shared space. Nothing is deleted immediately.
            </p>
          </div>
          <button
            ref={disconnectButton}
            className="danger-button"
            type="button"
            onClick={openConfirmation}
          >
            Disconnect
          </button>
        </section>

        <div className="account-footer">
          <p>Signed in as {viewerEmail}</p>
          <form action={signOut}>
            <button className="text-button" type="submit">Sign out</button>
          </form>
        </div>
      </div>

      {confirming && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConfirmation();
          }}
        >
          <section
            ref={dialog}
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-description"
            onKeyDown={keepFocusInDialog}
          >
            <span className="confirm-dialog__icon" aria-hidden="true">♥</span>
            <p className="eyebrow">Please be sure</p>
            <h2 id="confirm-title">Disconnect from {partnerName.split(" ")[0]}?</h2>
            <p id="confirm-description">
              Your shared chat and content will no longer be accessible. We’ll keep
              the history safely stored rather than deleting it right away.
            </p>

            {error && <p className="form-error" role="alert">{error}</p>}

            <div className="confirm-dialog__actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeConfirmation}
                disabled={isPending}
                autoFocus
              >
                Keep our space
              </button>
              <button
                className="danger-button danger-button--solid"
                type="button"
                onClick={disconnect}
                disabled={isPending}
              >
                {isPending ? "Disconnecting…" : "Yes, disconnect"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
