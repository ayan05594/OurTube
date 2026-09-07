import { NextResponse } from "next/server";

import { getCurrentConnection } from "@/lib/connections/queries";
import { statusForError, toActionError } from "@/lib/connections/errors";
import type { ActionResult, CurrentConnection } from "@/lib/connections/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getCurrentConnection();
    return json({ ok: true, data }, 200);
  } catch (error) {
    return json({ ok: false, error: toActionError(error) }, statusForError(error));
  }
}

function json(body: ActionResult<CurrentConnection>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Vary: "Cookie",
    },
  });
}
