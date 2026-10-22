import type { NextConfig } from "next";

/**
 * X AI — Next.js configuration.
 *
 * Security headers are set for every route. The gateway itself is only ever
 * contacted from server-side route handlers, so no CORS allowances are needed
 * for third-party origins here.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Image data URLs and generated images are rendered through <img>/Blob URLs,
  // so no remote image host allowlist is required.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
