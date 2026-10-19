import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "X AI — Image Prompt Studio & AI Chat",
    template: "%s · X AI",
  },
  description:
    "Turn a reference image into a highly detailed image-generation prompt, or chat with AI models through your own OmniRoute gateway. Chats stay in your browser.",
  applicationName: "X AI",
  authors: [{ name: "TAREK", url: "https://tarek0p.pages.dev/" }],
  creator: "TAREK",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: ["/icon.svg"],
  },
  openGraph: {
    title: "X AI — Image Prompt Studio & AI Chat",
    description:
      "Understand any image, generate a detailed prompt, and chat with models through a self-hosted OmniRoute gateway.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#020817",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-electric-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
