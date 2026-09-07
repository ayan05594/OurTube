import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  return fetchWorker(`https://ourtube.example${pathname}`);
}

async function fetchWorker(requestUrl, init = {}) {
  process.env.NEXT_PUBLIC_SITE_URL = "https://ourtube.example";
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  const origin = new URL(requestUrl);

  return worker.fetch(
    new Request(requestUrl, {
      ...init,
      headers: {
        accept: "text/html",
        host: origin.host,
        "x-forwarded-host": origin.host,
        "x-forwarded-proto": "https",
        ...init.headers,
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("Google sign-in form redirects to the OAuth start route", async () => {
  const landing = await render();
  const html = await landing.text();
  const action = html.match(/name="(\$ACTION_ID_[^"]+)"/i)?.[1];
  assert.ok(action, "missing rendered Google sign-in server action");

  const formData = new FormData();
  formData.set(action, "");
  const response = await fetchWorker("https://ourtube.example/", {
    method: "POST",
    body: formData,
  });

  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location, "missing Google OAuth redirect location");
  assert.equal(
    new URL(location, "https://ourtube.example").href,
    "https://ourtube.example/api/auth/google?next=%2Fconnect",
  );
});

test("OAuth starts on the canonical host before setting PKCE cookies", async () => {
  const response = await fetchWorker(
    "https://unexpected.example/api/auth/google?next=%2Four-space",
  );

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://ourtube.example/api/auth/google?next=%2Four-space",
  );
  assert.equal(response.headers.get("set-cookie"), null);
});

test("OAuth callback moves to the canonical host before PKCE exchange", async () => {
  const response = await fetchWorker(
    "https://unexpected.example/auth/callback?code=test-code&next=%2Four-space",
  );

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://ourtube.example/auth/callback?code=test-code&next=%2Four-space",
  );
  assert.equal(response.headers.get("set-cookie"), null);
});

test("server-renders the finished OurTube landing experience safely without secrets", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000",
  );
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /connect-src 'self' https: wss:/);
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);

  const html = await response.text();
  assert.match(html, /OurTube/);
  assert.match(html, /Continue with Google/);
  assert.match(html, /private video space/i);
  assert.match(html, /https:\/\/ourtube\.example\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});
