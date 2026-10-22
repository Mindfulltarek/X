import { ArrowUp, ImagePlus, Search, Sparkles } from "lucide-react";

import { XMark } from "@/components/brand/XMark";

/**
 * A compact, static preview of the real chat UI.
 *
 * This is a visual reference on the landing page only — the working app lives
 * at /chat. It is marked aria-hidden so screen readers skip the mock content.
 */
export function ChatPreview() {
  return (
    <div className="relative mx-auto w-full max-w-3xl" aria-hidden>
      <div className="absolute -inset-6 rounded-[2rem] bg-electric-500/10 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-midnight-950/92 shadow-panel">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-white/15" />
          <span className="h-2 w-2 rounded-full bg-white/15" />
          <span className="h-2 w-2 rounded-full bg-white/15" />
          <span className="ml-3 text-[0.72rem] font-medium text-ink-300">x-ai · image prompt studio</span>
        </div>

        <div className="flex min-h-[380px]">
          {/* Sidebar */}
          <div className="hidden w-48 shrink-0 flex-col gap-3 border-r border-white/10 p-3 sm:flex">
            <div className="flex items-center gap-2">
              <XMark size={22} glow={false} />
              <span className="text-xs font-semibold text-ink-200">
                X<span className="text-electric-300"> AI</span>
              </span>
            </div>
            <div className="rounded-lg bg-electric-500/90 px-2.5 py-1.5 text-[0.72rem] font-semibold text-white">
              + New chat
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-[0.66rem] font-medium text-ink-300">
              <Search size={10} /> Search chats
            </div>
            <p className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink-400">Today</p>
            {["Brutalist lobby concept", "Portrait lighting study", "Product shot brief"].map((title, i) => (
              <div
                key={title}
                className={`truncate rounded-md px-2 py-1.5 text-[0.68rem] font-medium ${
                  i === 0 ? "border border-electric-500/30 bg-electric-500/10 text-ink-200" : "text-ink-400"
                }`}
              >
                {title}
              </div>
            ))}
          </div>

          {/* Conversation */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 p-4">
              <div className="ml-auto max-w-[80%] rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-[0.68rem] text-ink-200">
                <div className="mb-2 h-16 w-24 rounded-md border border-white/10 bg-gradient-to-br from-electric-500/40 via-midnight-800 to-cyan-accent/20" />
                Turn this into a detailed image prompt.
              </div>
              <div className="max-w-[86%] rounded-xl border border-white/10 bg-midnight-900/60 px-3 py-2">
                <p className="mb-1.5 flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink-400">
                  <Sparkles size={9} className="text-cyan-accent" /> X AI · auto/vision
                </p>
                <div className="space-y-1">
                  <div className="h-1.5 w-[92%] rounded bg-white/12" />
                  <div className="h-1.5 w-[86%] rounded bg-white/10" />
                  <div className="h-1.5 w-[88%] rounded bg-white/10" />
                  <div className="h-1.5 w-[64%] rounded bg-white/10" />
                </div>
                <div className="mt-2 rounded-md border border-white/10 bg-midnight-950/70 p-2">
                  <div className="mb-1 flex justify-end">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[0.5rem] text-ink-300">Copy prompt</span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-1.5 w-[94%] rounded bg-cyan-accent/25" />
                    <div className="h-1.5 w-[80%] rounded bg-cyan-accent/20" />
                    <div className="h-1.5 w-[88%] rounded bg-cyan-accent/15" />
                  </div>
                </div>
              </div>
            </div>

            {/* Composer */}
            <div className="border-t border-white/5 p-3">
              <div className="flex items-center gap-2 rounded-xl border border-white/12 bg-midnight-900/80 px-3 py-2">
                <ImagePlus size={13} className="text-ink-400" />
                <span className="flex-1 text-[0.7rem] font-medium text-ink-300">Ask anything, or drop an image…</span>
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-electric-500 text-white">
                  <ArrowUp size={12} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[0.72rem] font-medium text-ink-300">Preview of the workspace — open it to use the live app.</p>
    </div>
  );
}
