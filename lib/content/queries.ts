import "server-only";

import { redirect } from "next/navigation";

import { UnauthenticatedError } from "@/lib/auth/errors";
import { pathWithQuery, safeRelativePath } from "@/lib/auth/redirects";
import { requireAuthenticatedContext } from "@/lib/auth/session";
import { ConnectionServiceError, notConnected } from "@/lib/connections/errors";
import { fetchCurrentConnection } from "@/lib/connections/rpc";
import type { ConnectedViewer, Partner } from "@/lib/connections/types";

import { fetchConnectedContent } from "./rpc";
import type {
  ConnectedContent,
  Favorite,
  OurTubeMessage,
  SharedVideo,
} from "./types";

export type ConnectedExperience = ConnectedContent &
  Readonly<{ connection: ConnectedViewer }>;

export async function getConnectedExperience(
  returnTo = "/our-space",
): Promise<ConnectedExperience> {
  try {
    const { supabase, user } = await requireAuthenticatedContext();
    const connection = await fetchCurrentConnection(supabase, user);
    if (connection.status !== "CONNECTED") throw notConnected();

    const content = await fetchConnectedContent(supabase);
    return { connection, ...content };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(
        pathWithQuery("/api/auth/google", {
          next: safeRelativePath(returnTo, "/our-space"),
        }),
      );
    }
    if (
      error instanceof ConnectionServiceError &&
      error.definition.code === "NOT_CONNECTED"
    ) {
      redirect("/connect");
    }
    throw error;
  }
}

export async function listMessages(): Promise<readonly OurTubeMessage[]> {
  return (await loadContent()).messages;
}

export async function listSharedVideos(): Promise<readonly SharedVideo[]> {
  return (await loadContent()).sharedVideos;
}

export async function listFavorites(): Promise<readonly Favorite[]> {
  return (await loadContent()).favorites;
}

export async function getPartner(): Promise<Partner> {
  const { supabase, user } = await requireAuthenticatedContext();
  const connection = await fetchCurrentConnection(supabase, user);
  if (connection.status !== "CONNECTED") throw notConnected();
  return connection.partner;
}

async function loadContent(): Promise<ConnectedContent> {
  const { supabase } = await requireAuthenticatedContext();
  return fetchConnectedContent(supabase);
}
