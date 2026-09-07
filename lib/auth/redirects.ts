const FALLBACK_ORIGIN = "https://ourtube.invalid";
const RESERVED_AUTH_PATHS = new Set([
  "/api/auth/google",
  "/auth/callback",
]);

export function safeRelativePath(
  value: string | null | undefined,
  fallback = "/",
): string {
  const safeFallback = normalizeFallback(fallback);
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return safeFallback;
  }

  try {
    const url = new URL(value, FALLBACK_ORIGIN);
    if (url.origin !== FALLBACK_ORIGIN || RESERVED_AUTH_PATHS.has(url.pathname)) {
      return safeFallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return safeFallback;
  }
}

export function pathWithQuery(
  pathname: string,
  values: Record<string, string | null | undefined>,
): string {
  const url = new URL(safeRelativePath(pathname), FALLBACK_ORIGIN);
  Object.entries(values).forEach(([name, value]) => {
    if (value) url.searchParams.set(name, value);
  });
  return `${url.pathname}${url.search}`;
}

function normalizeFallback(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, FALLBACK_ORIGIN);
    return url.origin === FALLBACK_ORIGIN
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}
