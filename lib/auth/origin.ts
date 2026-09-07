import "server-only";

export class SiteOriginConfigurationError extends Error {
  readonly name = "SiteOriginConfigurationError";

  constructor() {
    super(
      "Set NEXT_PUBLIC_SITE_URL to the canonical HTTPS origin before using OAuth outside localhost.",
    );
  }
}

/**
 * Returns the trusted site origin used for OAuth callbacks and redirects.
 * Request-derived origins are accepted only for loopback development hosts.
 */
export function requireSiteOrigin(requestOrigin?: string): string {
  const origin = getSiteOrigin(requestOrigin);
  if (!origin) throw new SiteOriginConfigurationError();
  return origin;
}

/**
 * Resolves a trusted origin when one is available. Unlike requireSiteOrigin,
 * metadata can use this to omit absolute social URLs on an unconfigured
 * deployment without weakening OAuth callback validation.
 */
export function getSiteOrigin(requestOrigin?: string): string | null {
  const configuredValue = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredValue) {
    const configured = parseSiteOrigin(configuredValue, true);
    if (!configured) return null;
    return configured;
  }

  const local = parseSiteOrigin(requestOrigin, true);
  if (local && isLoopback(new URL(local).hostname)) return local;

  return null;
}

function parseSiteOrigin(
  value: string | null | undefined,
  allowInsecureLoopback = false,
): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    const loopback = isLoopback(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(allowInsecureLoopback && loopback && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}
