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

test("browses and shares YouTube inside OurTube without paste-link inputs", async () => {
  const [picker, space, page, privacy] = await Promise.all([
    read("app/components/youtube-picker.tsx"),
    read("app/components/our-space.tsx"),
    read("app/our-space/page.tsx"),
    read("app/privacy/page.tsx"),
  ]);
  const browserUi = `${picker}\n${space}`;

  assert.match(space, /<YouTubePicker[\s\S]*kind=["']video["']/);
  assert.match(space, /<YouTubePicker[\s\S]*kind=["']short["']/);
  assert.match(space, /Find on YouTube/);
  assert.doesNotMatch(browserUi, /Paste (?:a )?YouTube/i);
  assert.doesNotMatch(browserUi, /<input[^>]+type=["']url["']/i);
  assert.doesNotMatch(browserUi, /name=["']youtubeUrl["']/i);

  assert.match(picker, /fetch\(\s*`\/api\/youtube\/search\?\$\{params\.toString\(\)\}`/);
  assert.match(picker, /method:\s*["']GET["']/);
  assert.match(picker, /credentials:\s*["']same-origin["']/);
  assert.match(picker, /const payload:\s*unknown\s*=\s*await response\.json\(\)/);
  assert.match(picker, /parseSearchResults\(payload,\s*kind\)/);
  assert.match(picker, /YOUTUBE_VIDEO_ID\.test\(videoId\)/);
  assert.match(picker, /isSafeThumbnail\(thumbnailUrl\)/);
  assert.match(picker, /isMatchingYouTubeUrl\(youtubeUrl,\s*videoId,\s*kind\)/);
  assert.match(picker, /ALLOWED_THUMBNAIL_HOSTS\.has\(url\.hostname\.toLowerCase\(\)\)/);
  assert.match(picker, /url\.protocol\s*===\s*["']https:["']/);

  assert.match(picker, /\/api\/auth\/youtube\?next=/);
  assert.match(picker, /same Google account you use to sign in to OurTube/i);
  assert.match(picker, /viewerEmail/);
  assert.match(picker, /https:\/\/www\.youtube\.com\/t\/terms/);
  assert.match(picker, /https:\/\/policies\.google\.com\/privacy/);
  assert.match(picker, /href=["']\/privacy["']/);
  assert.match(page, /params\.youtubeError/);
  assert.match(space, /initialOAuthError=/);
  assert.match(picker, /youtubeOAuthErrorMessage\(initialOAuthError,\s*viewerEmail\)/);
  assert.match(picker, /readApiError\(response\)/);
  assert.match(picker, /YouTube permission was not completed/);
  assert.match(privacy, /thumbnails are delivered from YouTube to your browser/);
  assert.match(picker, /<YouTubeEmbed[\s\S]*videoId=\{selected\.videoId\}/);
  assert.match(picker, /onClick=\{\(\)\s*=>\s*onShare\(selected\)\}/);
  assert.match(picker, /aria-label=\{`Preview \$\{result\.title\}/);
  assert.doesNotMatch(browserUi, /dangerouslySetInnerHTML/);
});

test("uses incremental read-only YouTube OAuth and server-only short-lived tokens", async () => {
  const [oauthStart, youtubeAuth, callback, signOut, browserComponents, migration] =
    await Promise.all([
      read("app/api/auth/youtube/route.ts"),
      read("lib/youtube/auth.ts"),
      read("app/auth/callback/route.ts"),
      read("app/actions/auth.ts"),
      sourceUnder("app/components"),
      read("supabase/migrations/202609070001_private_connections.sql"),
    ]);

  const requestedGoogleScopes = [
    ...new Set(
      oauthStart.match(/https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._/-]+/g) ?? [],
    ),
  ];
  assert.deepEqual(requestedGoogleScopes, [
    "https://www.googleapis.com/auth/youtube.readonly",
  ]);
  assert.match(oauthStart, /scopes:\s*YOUTUBE_READONLY_SCOPE/);
  assert.match(oauthStart, /include_granted_scopes:\s*["']true["']/);
  assert.match(oauthStart, /access_type:\s*["']online["']/);
  assert.match(oauthStart, /login_hint:\s*current\.user\.email/);
  assert.match(oauthStart, /YOUTUBE_PENDING_COOKIE,[\s\S]*current\.user\.id/);
  assert.ok(
    oauthStart.indexOf("supabase.auth.getUser()") <
      oauthStart.indexOf("supabase.auth.signInWithOAuth"),
    "the current OurTube user must be verified before incremental OAuth",
  );

  assert.match(youtubeAuth, /^import ["']server-only["'];/m);
  assert.match(youtubeAuth, /const ACCESS_TOKEN_MAX_AGE_SECONDS\s*=\s*3_300/);
  assert.match(youtubeAuth, /const PENDING_MAX_AGE_SECONDS\s*=\s*10\s*\*\s*60/);
  assert.match(youtubeAuth, /youtubeAccessCookieOptions[\s\S]*httpOnly:\s*true/);
  assert.match(youtubeAuth, /youtubeAccessCookieOptions[\s\S]*path:\s*["']\/api\/youtube["']/);
  assert.match(youtubeAuth, /youtubePendingCookieOptions[\s\S]*path:\s*["']\/["']/);
  assert.match(youtubeAuth, /sameSite:\s*["']lax["']/);
  assert.match(youtubeAuth, /secure:\s*process\.env\.NODE_ENV\s*===\s*["']production["']/);
  assert.match(youtubeAuth, /createYouTubeOwnerBinding\([\s\S]*crypto\.subtle\.importKey\([\s\S]*["']HMAC["'][\s\S]*["']SHA-256["']/);
  assert.match(youtubeAuth, /crypto\.subtle\.sign\(["']HMAC["'],\s*key,\s*encoder\.encode\(userId\)\)/);
  assert.match(callback, /data\.session\?\.provider_token/);
  assert.match(callback, /response\.cookies\.set\([\s\S]*YOUTUBE_ACCESS_COOKIE,[\s\S]*providerToken/);
  assert.match(callback, /response\.cookies\.set\([\s\S]*YOUTUBE_OWNER_COOKIE,[\s\S]*ownerBinding/);

  const forbiddenTokenStorage =
    /provider_token|ourtube-youtube-access|YOUTUBE_ACCESS_COOKIE|localStorage|sessionStorage|document\.cookie/i;
  assert.doesNotMatch(browserComponents, forbiddenTokenStorage);
  assert.doesNotMatch(
    migration,
    /provider_token|ourtube-youtube-access|youtube[_-]access[_-]token/i,
  );
  assert.match(signOut, /cookieStore\.set\(YOUTUBE_ACCESS_COOKIE,\s*["']["'],\s*youtubeAccessCookieOptions\(0\)\)/);
  assert.match(signOut, /cookieStore\.set\(YOUTUBE_OWNER_COOKIE,\s*["']["'],\s*youtubeAccessCookieOptions\(0\)\)/);
  assert.match(signOut, /cookieStore\.set\(YOUTUBE_PENDING_COOKIE,\s*["']["'],\s*youtubePendingCookieOptions\(0\)\)/);
});

test("guards the YouTube callback with the pending same-user identity", async () => {
  const [callback, proxy] = await Promise.all([
    read("app/auth/callback/route.ts"),
    read("proxy.ts"),
  ]);
  const pendingRead = callback.indexOf("request.cookies.get(YOUTUBE_PENDING_COOKIE)");
  const currentUserRead = callback.indexOf("supabase.auth.getUser()");
  const exchange = callback.indexOf("exchangeCodeForSession(code)");

  assert.match(callback, /getAll\(["']youtube["']\)/);
  assert.match(callback, /markers\.length\s*===\s*1\s*&&\s*markers\[0\]\s*===\s*["']1["']/);
  assert.ok(pendingRead >= 0 && pendingRead < exchange);
  assert.ok(currentUserRead >= 0 && currentUserRead < exchange);
  assert.match(callback, /pendingUserId\s*!==\s*beforeExchange\.user\.id/);
  assert.match(callback, /data\.user\.id\s*!==\s*beforeExchange\.user\?\.id/);
  assert.match(callback, /isProviderToken\(providerToken\)/);
  assert.match(callback, /createYouTubeOwnerBinding\(\s*data\.user\.id,\s*providerToken/);
  assert.match(callback, /youtube_account_mismatch/);
  assert.match(callback, /YOUTUBE_PENDING_COOKIE,[\s\S]*youtubePendingCookieOptions\(0\)/);
  assert.match(proxy, /youtubeMarkers\.length\s*===\s*1\s*&&\s*youtubeMarkers\[0\]\s*===\s*["']1["']/);
  assert.match(proxy, /callback\.searchParams\.set\(["']youtube["'],\s*["']1["']\)/);
});

test("proxies strict bounded YouTube discovery without exposing provider responses", async () => {
  const [route, youtubeClient] = await Promise.all([
    read("app/api/youtube/search/route.ts"),
    read("lib/youtube/client.ts"),
  ]);
  const userCheck = route.indexOf("supabase.auth.getUser()");
  const tokenRead = route.indexOf("request.cookies.get(YOUTUBE_ACCESS_COOKIE)");
  const discovery = route.indexOf("discoverYouTubeVideos(");

  assert.ok(userCheck >= 0 && userCheck < tokenRead && tokenRead < discovery);
  assert.match(route, /fetchCurrentConnection\(routeClient\.supabase/);
  assert.match(route, /connection\.status\s*!==\s*["']CONNECTED["']/);
  assert.match(route, /jsonError\(\s*["']NOT_CONNECTED["'][\s\S]*?403/);
  assert.match(route, /request\.cookies\.get\(YOUTUBE_OWNER_COOKIE\)/);
  assert.match(route, /createYouTubeOwnerBinding\(\s*data\.user\.id,\s*accessToken/);
  assert.match(route, /ownerBinding\s*!==\s*expectedOwnerBinding[\s\S]*?clearYouTubeAccessCookies\(response\)/);
  assert.match(route, /for \(const key of searchParams\.keys\(\)\)/);
  assert.match(route, /key\s*!==\s*["']kind["']\s*&&\s*key\s*!==\s*["']q["']/);
  assert.match(route, /kinds\.length\s*!==\s*1/);
  assert.match(route, /kinds\[0\]\s*!==\s*["']video["']\s*&&\s*kinds\[0\]\s*!==\s*["']short["']/);
  assert.match(route, /queries\.length\s*>\s*1/);
  assert.match(route, /rawQuery\.length\s*>\s*100/);
  assert.match(route, /rawQuery\.normalize\(["']NFKC["']\)/);
  assert.match(route, /normalizedQuery\.length\s*>\s*100/);
  assert.match(route, /INVALID_REQUEST[\s\S]*400/);
  assert.match(route, /Cache-Control[\s\S]*no-store/);
  assert.match(route, /Vary:\s*["']Cookie["']/);

  assert.match(youtubeClient, /^import ["']server-only["'];/m);
  assert.match(youtubeClient, /const MAX_RESULTS\s*=\s*12/);
  assert.match(youtubeClient, /url\.searchParams\.set\(["']maxResults["'],\s*String\(MAX_RESULTS\)\)/);
  assert.match(youtubeClient, /url\.searchParams\.set\(["']safeSearch["'],\s*["']strict["']\)/);
  assert.match(youtubeClient, /url\.searchParams\.set\(["']videoEmbeddable["'],\s*["']true["']\)/);
  assert.match(youtubeClient, /url\.searchParams\.set\(["']videoSyndicated["'],\s*["']true["']\)/);
  assert.match(youtubeClient, /["']snippet,status["']/);
  assert.match(youtubeClient, /item\.status\.embeddable\s*!==\s*true/);
  assert.match(youtubeClient, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(youtubeClient, /cache:\s*["']no-store["']/);
  assert.match(youtubeClient, /AbortSignal\.timeout\(10_000\)/);
  assert.match(youtubeClient, /`https:\/\/i\.ytimg\.com\/vi\/\$\{rawId\}\/mqdefault\.jpg`/);
  assert.match(youtubeClient, /`https:\/\/www\.youtube\.com\/shorts\/\$\{rawId\}`/);
  assert.match(youtubeClient, /`https:\/\/www\.youtube\.com\/watch\?v=\$\{rawId\}`/);
  assert.match(youtubeClient, /response\.text\(\)\)\.slice\(0,\s*32_768\)/);
  assert.match(youtubeClient, /class YouTubeApiError/);
  assert.doesNotMatch(route, /process\.env\..*YOUTUBE.*(?:KEY|SECRET)/i);
});

test("uses validated privacy-enhanced click-to-play embeds with responsive layouts", async () => {
  const [embed, space, css] = await Promise.all([
    read("app/components/youtube-embed.tsx"),
    read("app/components/our-space.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(embed, /\^\[A-Za-z0-9_-\]\{11\}\$/);
  assert.match(embed, /https:\/\/www\.youtube-nocookie\.com\/embed\/\$\{encodeURIComponent\(safeVideoId\)\}/);
  assert.match(embed, /if \(active\)[\s\S]*<iframe/);
  assert.match(embed, /className=["']youtube-embed__facade["'][\s\S]*onClick=\{onPlay\}/);
  assert.match(embed, /title=\{`YouTube player: \$\{title\}`\}/);
  assert.match(embed, /loading=["']lazy["']/);
  assert.match(embed, /referrerPolicy=["']strict-origin-when-cross-origin["']/);
  assert.match(embed, /allowFullScreen/);
  assert.match(embed, /variant:\s*["']video["']\s*\|\s*["']short["']/);
  assert.doesNotMatch(embed, /dangerouslySetInnerHTML/);

  assert.match(space, /useState<string \| null>\(null\)/);
  assert.match(space, /active=\{activePlayerId\s*===\s*video\.messageId\}/);
  assert.match(space, /active=\{activePlayerId\s*===\s*short\.messageId\}/);
  assert.match(space, /setActivePlayerId\(video\.messageId\)/);
  assert.match(space, /setActivePlayerId\(short\.messageId\)/);
  assert.match(space, /setActivePlayerId\(null\)/);

  assert.match(css, /\.youtube-embed--video\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /\.youtube-embed--short\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/);
  assert.match(css, /\.video-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\.shorts-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
  assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*?\.video-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*?\.shorts-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*360px\)/);
});

test("canonicalizes OAuth start before creating PKCE cookies", async () => {
  const [route, redirects] = await Promise.all([
    read("app/api/auth/google/route.ts"),
    read("lib/auth/redirects.ts"),
  ]);
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
  assert.match(
    redirects,
    /new URL\(normalizeFallback\(pathname\),\s*FALLBACK_ORIGIN\)/,
  );
});

test("guards landing auth readiness and canonicalizes callbacks before PKCE exchange", async () => {
  const [page, button, callback, proxy] = await Promise.all([
    read("app/page.tsx"),
    read("app/components/google-sign-in-button.tsx"),
    read("app/auth/callback/route.ts"),
    read("proxy.ts"),
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

  const recovery = proxy.indexOf("recoverRootOAuthCode(request)");
  const sessionUpdate = proxy.indexOf("updateSession(request)");
  assert.ok(recovery >= 0, "missing root OAuth-code recovery");
  assert.ok(recovery < sessionUpdate, "OAuth recovery must run before session middleware");
  assert.match(proxy, /request\.method\s*!==\s*["']GET["']/);
  assert.match(proxy, /request\.nextUrl\.pathname\s*!==\s*["']\/["']/);
  assert.match(proxy, /codes\.length\s*!==\s*1/);
  assert.match(proxy, /code\.length\s*>\s*4096/);
  assert.match(proxy, /safeRelativePath\(request\.nextUrl\.searchParams\.get\(["']next["']\),\s*["']\/connect["']\)/);
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
