import Image from "next/image";

/**
 * Full-page shader-gradient backdrop for the landing page.
 *
 * Performance note: the earlier version re-rendered a large SVG with an
 * `feTurbulence` + `feDisplacementMap` filter on every paint, which made the
 * whole page (and every button hover) feel sluggish. The gradient is now a
 * pre-rendered, optimised image served by next/image — visually identical,
 * but it costs the browser a single decode instead of a per-frame filter.
 *
 * - 2400×1500 source, sharp on high-DPI screens and at any zoom.
 * - `fill` + `object-cover`, so it covers every direction while scrolling.
 * - `priority` so it paints with the first frame (no flash, no layout shift).
 * - Static: no animation, nothing to re-composite on hover.
 */
export function ShaderBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden bg-[#030817]" aria-hidden>
      <Image
        src="/shader-bg.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        quality={90}
        className="select-none object-cover"
        draggable={false}
      />

      {/* Legibility scrim: keeps white copy crisp over the bright amber/pink areas.
          Pure gradient — cheap to composite. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(92% 66% at 46% 40%, rgba(3,8,23,0.66) 0%, rgba(3,8,23,0.44) 52%, rgba(3,8,23,0.2) 78%, rgba(3,8,23,0.62) 100%)",
        }}
      />
    </div>
  );
}
