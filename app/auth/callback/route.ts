import { NextResponse, type NextRequest } from "next/server";

import { requireSiteOrigin } from "@/lib/auth/origin";
import { pathWithQuery, safeRelativePath } from "@/lib/auth/redirects";
import { createRouteClient } from "@/lib/supabase/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRelativePath(
    request.nextUrl.searchParams.get("next"),
    "/connect",
  );

  let siteOrigin: string | undefined;

  try {
    siteOrigin = requireSiteOrigin(request.nextUrl.origin);
    if (!code || code.length > 4096) return callbackFailure(siteOrigin);

    const { supabase, applyTo } = createRouteClient(request);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) return applyTo(callbackFailure(siteOrigin));

    return applyTo(
      noStore(NextResponse.redirect(new URL(next, siteOrigin), 302)),
    );
  } catch {
    return callbackFailure(siteOrigin);
  }
}

function callbackFailure(siteOrigin?: string) {
  const pathname = pathWithQuery("/", { authError: "oauth_callback_failed" });
  return noStore(
    siteOrigin
      ? NextResponse.redirect(new URL(pathname, siteOrigin), 302)
      : new NextResponse(null, {
          status: 302,
          headers: { Location: pathname },
        }),
  );
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  return response;
}
