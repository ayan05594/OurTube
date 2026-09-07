import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectFlow } from "@/app/components/connect-flow";
import { getProtectedViewer } from "@/lib/connections/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create your connection",
  description: "Create or join a private OurTube space with a secure one-time code.",
};

export default async function ConnectPage() {
  const connection = await getProtectedViewer("/connect");
  if (connection.status === "CONNECTED") redirect("/our-space");

  return <ConnectFlow initialConnection={connection} />;
}
