"use client";

import { ImageDown } from "lucide-react";

/**
 * Full-window drag & drop overlay.
 *
 * Covers the entire viewport (not just the composer) while a file is dragged
 * over the app, and is `pointer-events-none` so the drop event still reaches
 * the window listener that attaches the image. Bright, neon, and impossible to
 * miss; only rendered while a real file drag is in progress.
 */
export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center bg-midnight-950/85 backdrop-blur-md"
      aria-hidden
    >
      {/* Animated neon frame around the whole screen */}
      <div className="absolute inset-3 rounded-[1.75rem] border-2 border-dashed border-cyan-200/70 shadow-[0_0_60px_-10px_rgba(40,215,242,0.85),inset_0_0_80px_-30px_rgba(37,99,235,0.9)] sm:inset-5" />
      <div className="relative mx-6 flex w-full max-w-lg flex-col items-center gap-5 rounded-3xl border border-electric-300/60 bg-midnight-900/80 px-8 py-14 text-center shadow-[0_0_80px_-20px_rgba(37,99,235,0.95)]">
        <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-200/60 bg-electric-500/20 text-cyan-100 shadow-[0_0_36px_-6px_rgba(40,215,242,0.95)]">
          <ImageDown size={34} aria-hidden />
        </span>
        <p className="text-2xl font-bold text-white">Drop a file here</p>
        <p className="max-w-sm text-[0.95rem] font-medium leading-7 text-ink-200">
          An image (PNG, JPEG, WebP, GIF), a PDF, a Word document or a text file. It is attached to the composer —
          nothing is sent until you press send.
        </p>
      </div>
    </div>
  );
}
