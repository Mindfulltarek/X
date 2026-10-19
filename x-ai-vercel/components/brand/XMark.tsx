import type { SVGProps } from "react";

/**
 * X AI brand mark (v2).
 *
 * Rebuilt from scratch: a dark navy rounded square with a crisp
 * electric-blue → cyan gradient outline and a bold, luminous "X" drawn with
 * rounded strokes. The palette now matches the app itself (royal blue, cyan,
 * midnight) instead of the pink/violet of the old placeholder, so the mark
 * reads as part of the product.
 *
 * Pure SVG: scales to any size, no remote assets, gradient ids are unique per
 * instance so several marks can live on one page.
 */
export function XMark({
  size = 40,
  className,
  title = "X AI",
  glow = true,
  ...props
}: { size?: number; className?: string; title?: string; glow?: boolean } & SVGProps<SVGSVGElement>) {
  const uid = `xm${size}${glow ? "g" : "n"}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id={`${uid}-ring`} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8FC6FF" />
          <stop offset="0.45" stopColor="#3B7BFF" />
          <stop offset="1" stopColor="#28D7F2" />
        </linearGradient>
        <linearGradient id={`${uid}-x`} x1="17" y1="15" x2="47" y2="49" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#BFE3FF" />
          <stop offset="0.4" stopColor="#6AA1FF" />
          <stop offset="1" stopColor="#28D7F2" />
        </linearGradient>
        <radialGradient id={`${uid}-bg`} cx="32" cy="24" r="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0b1b3d" />
          <stop offset="1" stopColor="#030b1e" />
        </radialGradient>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x="1" y="1" width="62" height="62" rx="17" fill={`url(#${uid}-bg)`} />
      <rect
        x="2.6"
        y="2.6"
        width="58.8"
        height="58.8"
        rx="15.4"
        fill="none"
        stroke={`url(#${uid}-ring)`}
        strokeWidth="2.6"
      />

      <g filter={glow ? `url(#${uid}-glow)` : undefined}>
        <path d="M18.5 17 L45.5 47" stroke={`url(#${uid}-x)`} strokeWidth="8" strokeLinecap="round" />
        <path d="M45.5 17 L18.5 47" stroke={`url(#${uid}-x)`} strokeWidth="8" strokeLinecap="round" />
      </g>

      {/* Four-point sparkles, matching the reference icon's accent shapes. */}
      <path
        d="M50.8 10 c.36 2.3 1.14 3.08 3.44 3.44 -2.3.36-3.08 1.14-3.44 3.44 -.36-2.3-1.14-3.08-3.44-3.44 2.3-.36 3.08-1.14 3.44-3.44Z"
        fill="#DFF4FF"
        opacity="0.95"
      />
      <path
        d="M12.2 44.6 c.28 1.8.9 2.42 2.7 2.7 -1.8.28-2.42.9-2.7 2.7 -.28-1.8-.9-2.42-2.7-2.7 1.8-.28 2.42-.9 2.7-2.7Z"
        fill="#BFEFFF"
        opacity="0.85"
      />
    </svg>
  );
}

/** Wordmark + icon lockup used in headers and the sidebar. */
export function XBrand({
  size = 34,
  showTagline = true,
  className = "",
}: {
  size?: number;
  showTagline?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <XMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-[1.1rem] font-semibold tracking-tight text-white">
          X <span className="text-cyan-200">AI</span>
        </span>
        {showTagline && (
          <span className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-ink-300">
            Image Prompt Studio
          </span>
        )}
      </span>
    </span>
  );
}
