"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  cancelPendingConnection,
  generateConnectionCode,
  joinConnectionByCode,
} from "@/app/actions/connections";
import { subscribeToConnectionChanges } from "@/lib/connections/realtime";
import type { CurrentConnection } from "@/lib/connections/types";
import { Brand } from "./brand";
import { UserAvatar } from "./user-avatar";

export type ConnectionView = CurrentConnection;

type ConnectFlowProps = {
  initialConnection: ConnectionView;
};

type RealtimeState = "connecting" | "live" | "recovering";

function formatCode(value: string) {
  const clean = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[ILO01]/g, "")
    .slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function formatRemaining(milliseconds: number) {
  const safe = Math.max(0, milliseconds);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function ConnectFlow({ initialConnection }: ConnectFlowProps) {
  const router = useRouter();
  const [connection, setConnection] = useState(initialConnection);
  const [mode, setMode] = useState<"choose" | "join">("choose");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
  const [now, setNow] = useState<number | null>(() => {
    if (initialConnection.status !== "PENDING" || !initialConnection.createdAt) {
      return null;
    }
    const createdAt = new Date(initialConnection.createdAt).getTime();
    return Number.isFinite(createdAt) ? createdAt : null;
  });
  const joinInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "join") joinInput.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (connection.status !== "PENDING") return;
    const { code, expiresAt, viewer } = connection;
    const updateClock = () => {
      const currentTime = Date.now();
      if (currentTime >= new Date(expiresAt).getTime()) {
        setConnection({ status: "EXPIRED", viewer, code, expiresAt });
      } else {
        setNow(currentTime);
      }
    };
    const kickoff = window.setTimeout(updateClock, 0);
    const interval = window.setInterval(updateClock, 1000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [connection]);

  useEffect(() => {
    if (connection.status !== "PENDING" && connection.status !== "CONNECTED") return;

    return subscribeToConnectionChanges(
      (updatedConnection) => {
        setRealtimeState("live");
        setConnection(updatedConnection);
      },
      (status) => {
        const normalized = String(status).toLowerCase();
        setRealtimeState(
          normalized.includes("subscribed") || normalized.includes("live")
            ? "live"
            : normalized.includes("error") || normalized.includes("closed")
              ? "recovering"
              : "connecting",
        );
      },
    );
  }, [connection.status]);

  useEffect(() => {
    if (connection.status !== "CONNECTED") return;
    const transition = window.setTimeout(() => {
      router.replace("/our-space");
    }, 2500);
    return () => window.clearTimeout(transition);
  }, [connection.status, router]);

  const remaining = useMemo(() => {
    if (connection.status !== "PENDING" || now === null) return null;
    return new Date(connection.expiresAt).getTime() - now;
  }, [connection, now]);

  function generateCode() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await generateConnectionCode();
      if (result.ok) {
        setNow(Date.now());
        setConnection(result.data);
        return;
      }
      setError(result.error.message);
    });
  }

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const code = formatCode(String(form.get("code") ?? ""));
    if (code.length !== 9) {
      setError("Enter the full 8-character connection code.");
      return;
    }

    startTransition(async () => {
      const result = await joinConnectionByCode(code);
      if (result.ok) {
        setConnection(result.data);
        return;
      }
      setError(result.error.message);
      joinInput.current?.focus();
    });
  }

  function cancelCode() {
    setError(null);
    startTransition(async () => {
      const result = await cancelPendingConnection();
      if (result.ok) {
        setConnection(result.data);
        return;
      }
      setError(result.error.message);
    });
  }

  async function copyCode() {
    if (connection.status !== "PENDING") return;
    try {
      await navigator.clipboard.writeText(connection.code);
      setNotice("Code copied");
    } catch {
      setNotice("Press and hold the code to copy it");
    }
  }

  async function shareCode() {
    if (connection.status !== "PENDING") return;
    const message = `Join me in our private OurTube space with code ${connection.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "OurTube connection", text: message });
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      }
    }
    await copyCode();
  }

  const viewer = connection.viewer;

  return (
    <main className="connect-page">
      <div className="connect-orb connect-orb--one" aria-hidden="true" />
      <div className="connect-orb connect-orb--two" aria-hidden="true" />

      <header className="connect-topbar">
        <Brand compact />
        <div className="signed-in-person">
          <div>
            <span>Signed in as</span>
            <strong>{viewer.name}</strong>
          </div>
          <UserAvatar name={viewer.name} imageUrl={viewer.avatarUrl} size="small" />
        </div>
      </header>

      <section className="connect-stage">
        {connection.status === "NOT_CONNECTED" && mode === "choose" && (
          <div className="connect-card connect-card--welcome">
            <div className="heart-halo" aria-hidden="true"><span>♥</span></div>
            <p className="eyebrow">Welcome to your private space</p>
            <h1>Make a space for <em>the two of you.</em></h1>
            <p className="connect-intro">
              Create a fresh code, or join the person who already made one. Either
              way, your videos and conversations stay between you two.
            </p>

            <div className="connect-choice-grid">
              <button
                className="choice-card choice-card--primary"
                type="button"
                onClick={generateCode}
                disabled={isPending}
              >
                <span className="choice-card__symbol" aria-hidden="true">＋</span>
                <span>
                  <strong>{isPending ? "Creating your code…" : "Generate a code"}</strong>
                  <small>You’ll share it privately with your partner</small>
                </span>
                <i aria-hidden="true">→</i>
              </button>

              <div className="or-divider"><span>or</span></div>

              <button
                className="choice-card"
                type="button"
                onClick={() => {
                  setMode("join");
                  setError(null);
                }}
                disabled={isPending}
              >
                <span className="choice-card__symbol choice-card__symbol--join" aria-hidden="true">⌁</span>
                <span>
                  <strong>Join with a code</strong>
                  <small>Enter the private code you received</small>
                </span>
                <i aria-hidden="true">→</i>
              </button>
            </div>

            {error && <p className="form-error" role="alert">{error}</p>}
            <p className="privacy-note"><span aria-hidden="true">●</span> One connection. Two people. Always private.</p>
          </div>
        )}

        {connection.status === "NOT_CONNECTED" && mode === "join" && (
          <div className="connect-card connect-card--join">
            <button
              className="back-button"
              type="button"
              onClick={() => {
                setMode("choose");
                setError(null);
              }}
            >
              <span aria-hidden="true">←</span>
              Back
            </button>
            <div className="mini-heart" aria-hidden="true">♥</div>
            <p className="eyebrow">Join your partner</p>
            <h1>Enter your private code.</h1>
            <p className="connect-intro">
              Ask your partner for the 8-character code shown on their screen.
            </p>

            <form className="join-form" onSubmit={join}>
              <label htmlFor="connection-code">Connection code</label>
              <input
                ref={joinInput}
                id="connection-code"
                name="code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck="false"
                maxLength={9}
                placeholder="A7K9-P2XM"
                aria-describedby="code-hint"
                aria-invalid={Boolean(error)}
                onChange={(event) => {
                  event.currentTarget.value = formatCode(event.currentTarget.value);
                  if (error) setError(null);
                }}
              />
              <p id="code-hint">The dash is added automatically.</p>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button primary-button--full" type="submit" disabled={isPending}>
                <span>{isPending ? "Connecting…" : "Connect our space"}</span>
                <span aria-hidden="true">♥</span>
              </button>
            </form>
            <p className="safety-copy">Codes expire at the time shown and can only be used once.</p>
          </div>
        )}

        {connection.status === "PENDING" && (
          <div className="connect-card connect-card--pending">
            <div className="waiting-visual" aria-hidden="true">
              <UserAvatar name={viewer.name} imageUrl={viewer.avatarUrl} size="large" />
              <span className="waiting-line"><i /><b>♥</b><i /></span>
              <span className="waiting-avatar">?</span>
            </div>
            <p className="eyebrow">Your connection is waiting</p>
            <h1>Share this code with <em>your person.</em></h1>
            <p className="connect-intro">
              Keep it private. The first eligible person to use it becomes your
              one OurTube connection.
            </p>

            <div className="code-panel">
              <span>Your one-time code</span>
              <button type="button" onClick={copyCode} aria-label={`Copy code ${connection.code}`}>
                {connection.code}
              </button>
              <div className="countdown-row">
                <span className={`realtime-dot realtime-dot--${realtimeState}`} aria-hidden="true" />
                <span>
                  {realtimeState === "live" ? "Waiting live" : realtimeState === "recovering" ? "Reconnecting" : "Connecting live"}
                </span>
                <i aria-hidden="true">·</i>
                <span>Expires in</span>
                <time dateTime={connection.expiresAt}>
                  {remaining === null ? "Calculating..." : formatRemaining(remaining)}
                </time>
              </div>
            </div>

            <div className="pending-actions">
              <button className="primary-button" type="button" onClick={copyCode}>
                <span aria-hidden="true">□</span>
                Copy code
              </button>
              <button className="secondary-button" type="button" onClick={shareCode}>
                <span aria-hidden="true">↗</span>
                Share privately
              </button>
            </div>

            <p className="waiting-caption">
              <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
              This screen will update the moment your partner joins.
            </p>
            {notice && <p className="toast-note" role="status">{notice}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="cancel-link" type="button" onClick={cancelCode} disabled={isPending}>
              {isPending ? "Cancelling…" : "Cancel this code"}
            </button>
          </div>
        )}

        {connection.status === "CONNECTED" && (
          <div className="connect-card connect-card--success">
            <div className="celebration-rings" aria-hidden="true">
              <span /><span /><span />
              <b>♥</b>
            </div>
            <p className="eyebrow">Your partner joined</p>
            <h1>You’re connected!</h1>
            <p className="connect-intro">
              Your private space with {connection.partner.name.split(" ")[0]} is ready.
              Everything you share stays between the two of you.
            </p>

            <div className="connected-pair">
              <div>
                <UserAvatar name={viewer.name} imageUrl={viewer.avatarUrl} size="large" />
                <strong>You</strong>
              </div>
              <span aria-hidden="true"><i />♥<i /></span>
              <div>
                <UserAvatar
                  name={connection.partner.name}
                  imageUrl={connection.partner.avatarUrl}
                  size="large"
                />
                <strong>{connection.partner.name.split(" ")[0]}</strong>
              </div>
            </div>

            <Link className="primary-button primary-button--full" href="/our-space">
              Enter OurTube
              <span aria-hidden="true">→</span>
            </Link>
            <p className="success-footnote" role="status">
              <span aria-hidden="true">●</span> Connected securely for just the two
              of you. Your shared space will open automatically.
            </p>
          </div>
        )}

        {(connection.status === "EXPIRED" || connection.status === "CANCELLED" || connection.status === "DISCONNECTED") && (
          <div className="connect-card connect-card--terminal">
            <div className="terminal-symbol" aria-hidden="true">
              {connection.status === "EXPIRED" ? "⌛" : "×"}
            </div>
            <p className="eyebrow">
              {connection.status === "EXPIRED" ? "Code expired" : connection.status === "DISCONNECTED" ? "Space disconnected" : "Code cancelled"}
            </p>
            <h1>Let’s make a fresh one.</h1>
            <p className="connect-intro">
              {connection.status === "EXPIRED"
                ? "That code reached its expiry time and can no longer be used."
                : connection.status === "DISCONNECTED"
                  ? "Your previous shared space is closed. You can now start a new private connection."
                  : "That code is no longer active. No one can use it to join your space."}
            </p>
            <button className="primary-button primary-button--full" type="button" onClick={generateCode} disabled={isPending}>
              <span aria-hidden="true">＋</span>
              {isPending ? "Creating…" : "Generate a new code"}
            </button>
            <button
              className="cancel-link"
              type="button"
              onClick={() => {
                setConnection({ status: "NOT_CONNECTED", viewer });
                setMode("join");
              }}
            >
              Join with a different code
            </button>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        )}
      </section>

      <footer className="connect-footer">
        <span>Private by design</span>
        <span aria-hidden="true">·</span>
        <Link href="/privacy">Your privacy</Link>
      </footer>
    </main>
  );
}
