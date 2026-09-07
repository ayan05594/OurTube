import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const nextConfig = await readFile(
  new URL("../next.config.ts", import.meta.url),
  "utf8",
);
const worker = await readFile(
  new URL("../worker/index.ts", import.meta.url),
  "utf8",
);

test("uses native Next.js output for Vercel while preserving the Sites build", () => {
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(packageJson.scripts["build:sites"], "vinext build");
  assert.equal(packageJson.engines.node, "22.x");
});

test("applies production security headers to the native Next.js deployment", () => {
  assert.match(nextConfig, /poweredByHeader:\s*false/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /default-src 'self'/);
  assert.match(
    nextConfig,
    /["']frame-src https:\/\/www\.youtube-nocookie\.com["']/,
  );
  assert.doesNotMatch(nextConfig, /["']frame-src 'none'["']/);
  assert.match(
    nextConfig,
    /key:\s*["']Referrer-Policy["'][\s\S]*?value:\s*["']strict-origin-when-cross-origin["']/,
  );
  assert.match(nextConfig, /Strict-Transport-Security/);
  assert.match(nextConfig, /X-Content-Type-Options/);
  assert.match(nextConfig, /X-Frame-Options/);
});

test("keeps the Sites worker aligned while preserving redirect privacy", () => {
  assert.match(
    worker,
    /["']frame-src https:\/\/www\.youtube-nocookie\.com["']/,
  );
  assert.doesNotMatch(worker, /["']frame-src 'none'["']/);
  assert.match(
    worker,
    /if\s*\(\s*!headers\.has\(["']Referrer-Policy["']\)\s*\)\s*\{[\s\S]*?headers\.set\(\s*["']Referrer-Policy["'],\s*["']strict-origin-when-cross-origin["']/,
  );
});
