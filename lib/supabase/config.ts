export type SupabaseConfig = Readonly<{
  url: string;
  anonKey: string;
}>;

export class SupabaseConfigurationError extends Error {
  readonly name = "SupabaseConfigurationError";

  constructor() {
    super(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
}

/**
 * Read lazily so importing a server module does not make static builds depend on
 * deployment secrets. NEXT_PUBLIC_* property access must stay explicit so the
 * browser bundle can replace it at build time.
 */
export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey || !isHttpUrl(url)) return null;

  return { url, anonKey };
}

export function requireSupabaseConfig(): SupabaseConfig {
  const config = getSupabaseConfig();
  if (!config) throw new SupabaseConfigurationError();
  return config;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
