import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthenticatedUser } from "@/lib/auth/types";
import type { Database, Json } from "@/lib/supabase/database.types";

import { fromPostgrestError } from "./errors";
import { parseConnectionState } from "./parse";
import type { CurrentConnection } from "./types";

type ConnectionClient = SupabaseClient<Database>;

export async function fetchCurrentConnection(
  supabase: ConnectionClient,
  viewer: AuthenticatedUser,
): Promise<CurrentConnection> {
  const { data, error } = await supabase.rpc("get_current_connection");
  if (error) throw fromPostgrestError(error);
  return parseConnectionState(data, viewer);
}

export async function generateCode(
  supabase: ConnectionClient,
  viewer: AuthenticatedUser,
): Promise<CurrentConnection> {
  return runMutation(supabase, viewer, "generate_connection_code");
}

export async function joinByCode(
  supabase: ConnectionClient,
  viewer: AuthenticatedUser,
  code: string,
): Promise<CurrentConnection> {
  const { data, error } = await supabase.rpc("join_connection_by_code", {
    p_code: code,
  });
  if (error) throw fromPostgrestError(error);
  return parseConnectionState(data, viewer);
}

export async function cancelCode(
  supabase: ConnectionClient,
  viewer: AuthenticatedUser,
): Promise<CurrentConnection> {
  return runMutation(supabase, viewer, "cancel_connection");
}

export async function disconnect(
  supabase: ConnectionClient,
  viewer: AuthenticatedUser,
): Promise<CurrentConnection> {
  return runMutation(supabase, viewer, "disconnect_connection");
}

async function runMutation(
  supabase: ConnectionClient,
  viewer: AuthenticatedUser,
  name:
    | "generate_connection_code"
    | "cancel_connection"
    | "disconnect_connection",
): Promise<CurrentConnection> {
  const result = await supabase.rpc(name);
  if (result.error) throw fromPostgrestError(result.error);
  return parseConnectionState(result.data as Json, viewer);
}
