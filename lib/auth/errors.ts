export class UnauthenticatedError extends Error {
  readonly name = "UnauthenticatedError";

  constructor(readonly reason: "missing" | "google_required" = "missing") {
    super(
      reason === "google_required"
        ? "Google authentication is required."
        : "Authentication is required.",
    );
  }
}
