import type { Metadata } from "next";
import { OurSpace } from "@/app/components/our-space";
import { getConnectedExperience } from "@/lib/content/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Our shared space",
  description: "Your private videos, Shorts, favorites, and conversation.",
};

type OurSpacePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OurSpacePage({ searchParams }: OurSpacePageProps) {
  const params = (await searchParams) ?? {};
  const pickerValue = Array.isArray(params.picker) ? params.picker[0] : params.picker;
  const youtubeErrorValue = Array.isArray(params.youtubeError)
    ? params.youtubeError[0]
    : params.youtubeError;
  const initialPicker = pickerValue === "video" || pickerValue === "short" ? pickerValue : null;
  const { connection, messages, sharedVideos, favorites } = await getConnectedExperience();
  return (
    <OurSpace
      connection={connection}
      initialContent={{ messages, sharedVideos, favorites }}
      initialPicker={initialPicker}
      initialYouTubeError={typeof youtubeErrorValue === "string" ? youtubeErrorValue : null}
    />
  );
}
