import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const connectSources = [
  "connect-src 'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
  ...(isProduction
    ? []
    : [
        "http://localhost:*",
        "ws://localhost:*",
        "http://127.0.0.1:*",
        "ws://127.0.0.1:*",
      ]),
];

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  connectSources.join(" "),
  isProduction ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Referrer-Policy",
    value: "no-referrer",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=()",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const privateNoStoreHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0, must-revalidate",
  },
  {
    key: "Pragma",
    value: "no-cache",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/",
        headers: privateNoStoreHeaders,
      },
      {
        source: "/dashboard/:path*",
        headers: privateNoStoreHeaders,
      },
      {
        source: "/api/expenses",
        headers: privateNoStoreHeaders,
      },
      {
        source: "/api/summary",
        headers: privateNoStoreHeaders,
      },
      {
        source: "/api/budget",
        headers: privateNoStoreHeaders,
      },
      {
        source: "/api/line/webhook",
        headers: privateNoStoreHeaders,
      },
    ];
  },
};

export default nextConfig;
