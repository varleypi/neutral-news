import type { NextConfig } from "next";

/**
 * Next's dev server compiles client code through a react-refresh runtime that
 * evaluates strings, so a CSP without 'unsafe-eval' stops the app hydrating
 * locally — and with it every client script on the page, AdSense and Analytics
 * included. Allowing eval in development only keeps local testing honest
 * without loosening anything that ships.
 */
const isDev = process.env.NODE_ENV === 'development'

const scriptSrc = [
  "script-src 'self' 'unsafe-inline'",
  isDev ? "'unsafe-eval'" : null,
  'https://pagead2.googlesyndication.com',
  'https://*.adtrafficquality.google',
  'https://www.googletagservices.com',
  'https://www.googletagmanager.com',
]
  .filter(Boolean)
  .join(' ')

const securityHeaders = [
  // Prevent the site being embedded in iframes (clickjacking)
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Only send origin on cross-origin requests
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable powerful browser features the site does not use
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Enforce HTTPS for two years, including subdomains
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Restrict where scripts, styles, and frames may load from.
  // Google AdSense domains are allowed for ad serving, and
  // googletagmanager/google-analytics for Google Analytics 4.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-inline' is required by the gtag bootstrap snippet as well as
      // AdSense; both are injected inline rather than as external files.
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      // GA4 beacons go to google-analytics.com, or to a regional host such as
      // region1.google-analytics.com for EU traffic — hence the wildcards.
      // Without these the hits are silently blocked and the property stays empty.
      "connect-src 'self' https://*.supabase.co https://pagead2.googlesyndication.com https://*.adtrafficquality.google https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com",
      "frame-src https://googleads.g.doubleclick.net https://*.adtrafficquality.google https://tpc.googlesyndication.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
