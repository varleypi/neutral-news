import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/**
 * Served at /robots.txt.
 *
 * This file 404'd for the site's entire life, which walls crawlers off before
 * they ever reach the content — the same issue that blocked AdSense approval on
 * SpinDetector. Mediapartners-Google and AdsBot-Google are named explicitly:
 * they are the crawlers AdSense uses to review a site for ad serving.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      { userAgent: 'Mediapartners-Google', allow: '/' },
      { userAgent: 'AdsBot-Google', allow: '/' },
      { userAgent: 'AdsBot-Google-Mobile', allow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
