import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * X-XSS-Protection is deliberately omitted: it is deprecated and modern
 * browsers (Chromium, Firefox) either ignore it or do not implement it.
 * OWASP recommends not setting it.
 */
const BASE_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/**
 * Same as the baseline, but with X-Frame-Options relaxed to SAMEORIGIN
 * for routes that must be embeddable in same-origin <iframe> elements
 * (PDF preview dialogs, logo previews, …).
 */
const IFRAME_ALLOWED_HEADERS = BASE_SECURITY_HEADERS.map((h) =>
  h.key === "X-Frame-Options" ? { ...h, value: "SAMEORIGIN" } : h,
);

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    // Next.js evaluates rules in declaration order and later rules override
    // earlier ones for the same header key on overlapping paths. Therefore
    // we declare the global baseline FIRST, then iframe-relaxed overrides.
    return [
      {
        source: "/(.*)",
        headers: BASE_SECURITY_HEADERS,
      },
      {
        source: "/api/invoices/download",
        headers: IFRAME_ALLOWED_HEADERS,
      },
      {
        source: "/api/invoices/viewer",
        headers: IFRAME_ALLOWED_HEADERS,
      },
      {
        source: "/api/quotes/download",
        headers: IFRAME_ALLOWED_HEADERS,
      },
      {
        source: "/api/expenses/download",
        headers: IFRAME_ALLOWED_HEADERS,
      },
      {
        source: "/api/files/:path*",
        headers: IFRAME_ALLOWED_HEADERS,
      },
    ];
  },
};

export default nextConfig;
