import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function sourceUnder(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];
  for (const entry of entries) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) chunks.push(await sourceUnder(relative));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) chunks.push(await read(relative));
  }
  return chunks.join("\n");
}

test("uses Google OAuth with verified cookie sessions and no privileged browser key", async () => {
  const [app, lib, env, proxy] = await Promise.all([
    sourceUnder("app"),
    sourceUnder("lib"),
    read(".env.example"),
    read("proxy.ts"),
  ]);
  const source = `${app}\n${lib}`;

  assert.match(source, /provider:\s*["']google["']/);
  assert.match(source, /exchangeCodeForSession/);
  assert.match(source, /auth\.getUser\(\)|auth\.getClaims\(\)/);
  assert.match(proxy, /updateSession/);
  assert.doesNotMatch(source + env, /SUPABASE_SERVICE_ROLE(?:_KEY)?/i);
  assert.doesNotMatch(source + env, /USER_[AB]_(?:EMAIL|ID)|ALLOWED_USER_[AB]/i);
  assert.match(env, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(env, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

test("routes the complete connection lifecycle through authenticated RPC operations", async () => {
  const [actions, rpc, realtime, connectUi, code] = await Promise.all([
    read("app/actions/connections.ts"),
    read("lib/connections/rpc.ts"),
    read("lib/connections/realtime.ts"),
    read("app/components/connect-flow.tsx"),
    read("lib/connections/code.ts"),
  ]);
  const source = `${actions}\n${rpc}`;

  for (const operation of [
    "generate_connection_code",
    "join_connection_by_code",
    "cancel_connection",
    "disconnect_connection",
    "get_current_connection",
  ]) {
    assert.match(source, new RegExp(operation));
  }

  assert.match(code, /ABCDEFGHJKMNPQRSTUVWXYZ23456789/);
  assert.match(connectUi, /NOT_CONNECTED/);
  assert.match(connectUi, /PENDING/);
  assert.match(connectUi, /CONNECTED/);
  assert.match(connectUi, /EXPIRED/);
  assert.match(connectUi, /CANCELLED/);
  assert.match(connectUi, /DISCONNECTED/);
  assert.match(connectUi, /navigator\.clipboard/);
  assert.match(connectUi, /navigator\.share/);
  assert.match(connectUi, /Expires in/);
  assert.match(realtime, /config:\s*{\s*private:\s*true/);
  assert.match(realtime, /connection:\$\{data\.user\.id\}/);
  assert.match(realtime, /broadcast/);
  assert.doesNotMatch(realtime, /\.on\(\s*["']postgres_changes/);
});

test("keeps connected content behind typed authenticated server actions", async () => {
  const [actions, rpc, types, errors, ui] = await Promise.all([
    read("app/actions/content.ts"),
    read("lib/content/rpc.ts"),
    read("lib/supabase/database.types.ts"),
    read("lib/connections/errors.ts"),
    read("app/components/our-space.tsx"),
  ]);
  const source = `${actions}\n${rpc}`;

  assert.match(source, /requireAuthenticatedContext/);
  for (const operation of [
    "get_connected_content",
    "send_message",
    "toggle_message_reaction",
    "toggle_favorite",
    "set_favorite_visibility",
  ]) {
    assert.match(source, new RegExp(operation));
  }

  assert.match(ui, /sendTextMessage/);
  assert.match(ui, /shareVideo/);
  assert.match(ui, /shareShort/);
  assert.match(ui, /toggleMessageReaction/);
  assert.match(ui, /toggleFavorite/);
  assert.match(ui, /private/);
  assert.match(ui, /shared/);
  assert.match(types, /ContentMutationRpcErrorResult/);
  assert.match(types, /QUOTA_EXCEEDED/);
  assert.match(rpc, /throwIfContentMutationError\(data\)/);
  assert.match(rpc, /retry_after_seconds/);
  assert.match(errors, /QUOTA_EXCEEDED[\s\S]*status:\s*409/);
});

test("canonicalizes OAuth start before creating PKCE cookies", async () => {
  const route = await read("app/api/auth/google/route.ts");
  const canonicalCheck = route.indexOf("request.nextUrl.origin !== siteOrigin");
  const routeClientCreation = route.indexOf("createRouteClient(request)");

  assert.ok(canonicalCheck >= 0, "missing canonical-origin check");
  assert.ok(
    canonicalCheck < routeClientCreation,
    "PKCE client must be created only after canonical redirect",
  );
  assert.match(route, /new URL\(["']\/api\/auth\/google["'],\s*siteOrigin\)/);
  assert.match(route, /canonicalStart\.searchParams\.set\(["']next["'],\s*next\)/);
  assert.match(route, /NextResponse\.redirect\(canonicalStart,\s*307\)/);
});

test("guards landing auth readiness and canonicalizes callbacks before PKCE exchange", async () => {
  const [page, button, callback] = await Promise.all([
    read("app/page.tsx"),
    read("app/components/google-sign-in-button.tsx"),
    read("app/auth/callback/route.ts"),
  ]);

  assert.match(page, /isSupabaseConfigured\(\)/);
  assert.match(page, /getSiteOrigin\(\)\s*!==\s*null/);
  assert.match(page, /disabled={!authenticationConfigured}/);
  assert.match(button, /disabled={disabled \|\| pending}/);

  const canonicalCheck = callback.indexOf("request.nextUrl.origin !== siteOrigin");
  const routeClientCreation = callback.indexOf("createRouteClient(request)");
  const exchange = callback.indexOf("exchangeCodeForSession(code)");
  assert.ok(canonicalCheck >= 0, "missing callback canonical-origin check");
  assert.ok(canonicalCheck < routeClientCreation);
  assert.ok(canonicalCheck < exchange);
  assert.match(callback, /new URL\(["']\/auth\/callback["'],\s*siteOrigin\)/);
  assert.match(callback, /canonicalCallback\.searchParams\.set\(["']next["'],\s*next\)/);
  assert.match(callback, /NextResponse\.redirect\(canonicalCallback,\s*307\)/);
});

test("removes the disposable starter preview from the finished product", async () => {
  const [page, layout, packageJson] = await Promise.all([
    read("app/page.tsx"),
    read("app/layout.tsx"),
    read("package.json"),
  ]);
  const source = `${page}\n${layout}`;

  assert.doesNotMatch(source, /_sites-preview|SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(layout, /OurTube/);
  assert.match(layout, /og\.png/);
});
