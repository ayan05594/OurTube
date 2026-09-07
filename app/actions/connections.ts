"use server";

import { revalidatePath } from "next/cache";

import { requireAuthenticatedContext } from "@/lib/auth/session";
import { normalizeConnectionCode } from "@/lib/connections/code";
import { invalidCode, toActionError } from "@/lib/connections/errors";
import {
  cancelCode,
  disconnect,
  fetchCurrentConnection,
  generateCode,
  joinByCode,
} from "@/lib/connections/rpc";
import type { ActionResult, CurrentConnection } from "@/lib/connections/types";

export async function generateConnectionCode(): Promise<
  ActionResult<CurrentConnection>
> {
  return execute(async () => {
    const { supabase, user } = await requireAuthenticatedContext();
    return generateCode(supabase, user);
  });
}

export async function joinConnectionByCode(
  input: string | FormData,
): Promise<ActionResult<CurrentConnection>> {
  return execute(async () => {
    const rawCode =
      typeof input === "string" ? input : readFormString(input, "code") ?? "";
    const code = normalizeConnectionCode(rawCode);
    if (!code) throw invalidCode();

    const { supabase, user } = await requireAuthenticatedContext();
    return joinByCode(supabase, user, code);
  });
}

export async function cancelPendingConnection(): Promise<
  ActionResult<CurrentConnection>
> {
  return execute(async () => {
    const { supabase, user } = await requireAuthenticatedContext();
    return cancelCode(supabase, user);
  });
}

export async function disconnectCurrentConnection(): Promise<
  ActionResult<CurrentConnection>
> {
  return execute(async () => {
    const { supabase, user } = await requireAuthenticatedContext();
    return disconnect(supabase, user);
  });
}

export async function refreshCurrentConnection(): Promise<
  ActionResult<CurrentConnection>
> {
  return execute(async () => {
    const { supabase, user } = await requireAuthenticatedContext();
    return fetchCurrentConnection(supabase, user);
  }, false);
}

async function execute(
  operation: () => Promise<CurrentConnection>,
  revalidate = true,
): Promise<ActionResult<CurrentConnection>> {
  try {
    const data = await operation();
    if (revalidate) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

function readFormString(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}
