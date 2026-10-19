import Link from "next/link";

/** Landing / policy footer with the required credit link. */
export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-white/10 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5">
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[0.95rem] font-medium text-ink-200">
          <Link href="/privacy" className="transition hover:text-ink-100">
            Privacy Policy
          </Link>
          <Link href="/terms" className="transition hover:text-ink-100">
            Terms of Use
          </Link>
          <Link href="/ai-usage" className="transition hover:text-ink-100">
            AI Provider &amp; Usage
          </Link>
          <Link href="/chat" className="transition hover:text-ink-100">
            Open workspace
          </Link>
        </nav>

        <p className="max-w-2xl text-center text-sm leading-7 text-ink-300">
          X AI does not provide AI models itself. Answers come from the providers connected to the site&apos;s
          OmniRoute gateway, subject to their quotas, capabilities and terms.
        </p>

        <p className="text-base font-medium text-ink-200">
          Developed by{" "}
          <a
            href="https://tarek0p.pages.dev/"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center rounded-lg px-2 py-1 text-lg font-bold text-cyan-200 transition hover:text-white"
            style={{ textShadow: "0 0 16px rgba(40,215,242,0.9), 0 0 38px rgba(37,99,235,0.6)" }}
          >
            TAREK
            <span className="sr-only"> (opens portfolio in a new tab)</span>
          </a>
        </p>
      </div>
    </footer>
  );
}
