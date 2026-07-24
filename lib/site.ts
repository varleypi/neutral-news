/**
 * The one canonical origin for the site.
 *
 * The apex `neutralnews.us` 308-redirects to `www`, so every URL we emit —
 * canonical tags, sitemap entries, RSS links — must be the www form. Pointing
 * them at the apex would make every canonical a redirect, which is a weak and
 * ambiguous signal to crawlers.
 */
export const SITE_URL = 'https://www.neutralnews.us'

export const SITE_NAME = 'Neutral News'

/** Absolute URL for a site-relative path, e.g. canonical('/about'). */
export function canonical(path = '/'): string {
  return new URL(path, SITE_URL).toString()
}
