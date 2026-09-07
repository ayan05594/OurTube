"use client";

import { useFormStatus } from "react-dom";

export function GoogleSignInButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button className="google-button" type="submit" disabled={disabled || pending}>
      <span className="google-mark" aria-hidden="true">
        G
      </span>
      <span>{pending ? "Opening Google…" : "Continue with Google"}</span>
      <span className="button-arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}
