import type { Metadata } from "next";
import { OurSpace } from "@/app/components/our-space";
import { getConnectedExperience } from "@/lib/content/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Our shared space",
  description: "Your private videos, Shorts, favorites, and conversation.",
};

export default async function OurSpacePage() {
  const { connection, messages, sharedVideos, favorites } = await getConnectedExperience();
  return (
    <OurSpace
      connection={connection}
      initialContent={{ messages, sharedVideos, favorites }}
    />
  );
}
