import { NextResponse } from "next/server";

import { requireAuthenticatedContext } from "@/lib/auth/session";
import { fetchConnectedContent } from "@/lib/content/rpc";
import type { ConnectedContent } from "@/lib/content/types";
import { statusForError, toActionError } from "@/lib/connections/errors";
import type { ActionResult } from "@/lib/connections/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase } = await requireAuthenticatedContext();
    const data = await fetchConnectedContent(supabase);
    return json({ ok: true, data }, 200);
  } catch (error) {
    return json({ ok: false, error: toActionError(error) }, statusForError(error));
  }
}

function json(body: ActionResult<ConnectedContent>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Vary: "Cookie",
    },
  });
}
