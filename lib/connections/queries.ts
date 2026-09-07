import "server-only";

import { redirect } from "next/navigation";

import { UnauthenticatedError } from "@/lib/auth/errors";
import { pathWithQuery, safeRelativePath } from "@/lib/auth/redirects";
import { requireAuthenticatedContext } from "@/lib/auth/session";

import { fetchCurrentConnection } from "./rpc";
import type { CurrentConnection } from "./types";

export async function getCurrentConnection(): Promise<CurrentConnection> {
  const { supabase, user } = await requireAuthenticatedContext();
  return fetchCurrentConnection(supabase, user);
}

/** A semantic alias for protected layouts/pages that load viewer + connection. */
export async function getProtectedViewer(
  returnTo = "/connect",
): Promise<CurrentConnection> {
  try {
    return await getCurrentConnection();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(
        pathWithQuery("/api/auth/google", {
          next: safeRelativePath(returnTo, "/connect"),
        }),
      );
    }
    throw error;
  }
}
