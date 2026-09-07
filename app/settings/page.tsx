import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsView } from "@/app/components/settings-view";
import { getProtectedViewer } from "@/lib/connections/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your private OurTube connection.",
};

export default async function SettingsPage() {
  const connection = await getProtectedViewer("/settings");
  if (connection.status !== "CONNECTED") redirect("/connect");

  return (
    <SettingsView
      viewerName={connection.viewer.name}
      viewerEmail={connection.viewer.email ?? "Google account"}
      viewerAvatarUrl={connection.viewer.avatarUrl}
      partnerName={connection.partner.name}
      partnerAvatarUrl={connection.partner.avatarUrl}
      connectedAt={connection.connectedAt}
    />
  );
}
