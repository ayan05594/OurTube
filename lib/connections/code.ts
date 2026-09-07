const COMPACT_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const MAX_INPUT_LENGTH = 64;

export function normalizeConnectionCode(input: string): string | null {
  if (input.length > MAX_INPUT_LENGTH) return null;

  const compact = input
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");

  if (!COMPACT_CODE.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
