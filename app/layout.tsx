import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import { getSiteOrigin } from "@/lib/auth/origin";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

const description =
  "Share YouTube videos, Shorts, and conversations in one private space made for just two people.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const resolvedOrigin = getSiteOrigin(requestOrigin(requestHeaders).origin);
  const origin = resolvedOrigin ? new URL(resolvedOrigin) : undefined;
  const socialImage = origin ? new URL("/og.png", origin) : undefined;

  return {
    metadataBase: origin,
    title: {
      default: "OurTube - A private video space for two",
      template: "%s - OurTube",
    },
    description,
    openGraph: {
      type: "website",
      siteName: "OurTube",
      title: "OurTube - A private video space for two",
      description,
      images: socialImage
        ? [
            {
              url: socialImage,
              width: 1733,
              height: 908,
              alt: "OurTube - Your private video space.",
            },
          ]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: "OurTube - A private video space for two",
      description,
      images: socialImage ? [socialImage] : undefined,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbf6f1",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} antialiased`}>{children}</body>
    </html>
  );
}

function requestOrigin(requestHeaders: Headers): URL {
  const host = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    ""
  )
    .split(",")[0]
    .trim();
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim()
    .toLowerCase();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
        ? "http"
        : "https";

  if (
    host &&
    /^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(host)
  ) {
    try {
      return new URL(`${protocol}://${host}`);
    } catch {
      // Fall through to a deterministic local build origin.
    }
  }

  return new URL("http://localhost:3000");
}
