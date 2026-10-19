import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { XBrand } from "@/components/brand/XMark";
import { SiteFooter } from "@/components/landing/SiteFooter";

/** Shared shell for the Privacy / Terms / AI Usage pages. */
export function PolicyLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="space-bg" aria-hidden />
      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" aria-label="X AI home" className="rounded-xl">
            <XBrand size={34} showTagline={false} />
          </Link>
          <Link href="/chat" className="btn-ghost px-4 py-2 text-xs">
            <ArrowLeft size={13} aria-hidden />
            Back to workspace
          </Link>
        </div>
      </header>

      <main id="main" className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-100">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-ink-400">{intro}</p>
        <p className="mt-2 text-xs text-ink-500">
          Informational template, not legal advice. Last reviewed: October 2026.
        </p>
        <div className="mt-8 space-y-7 text-sm leading-7 text-ink-300">{children}</div>
      </main>

      <SiteFooter />
    </div>
  );
}

export function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-ink-100">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
