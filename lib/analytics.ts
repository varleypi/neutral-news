/**
 * Google Analytics 4 configuration.
 *
 * The measurement ID is public — it ships in the page source of every GA4 site,
 * the same way the AdSense client ID does — but it lives in an env var rather
 * than the repo so that preview deploys and forks don't report into the
 * production property and inflate its numbers.
 *
 * Nothing is loaded and no events are sent when it's unset, which is the case
 * for a plain `npm run dev`. That keeps local page views out of the real
 * property without needing an internal-traffic filter in GA4.
 *
 * Server-safe by design: this module is imported by the root layout, so it must
 * not reach for `window` or pull in `@next/third-parties`, which is a client
 * module. Event senders live in `components/ArticleLink.tsx` instead.
 */

/** GA4 measurement ID, e.g. `G-XXXXXXXXXX`. Empty string means analytics off. */
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID || ''

/** Whether to load gtag.js and emit events at all. */
export const analyticsEnabled = GA_MEASUREMENT_ID !== ''

/**
 * `item_list_name` values for the article-click event.
 *
 * GA4 reports `item_list_name` as a built-in dimension, so these strings show up
 * in the Events report with no custom definition to register. Keep the set small
 * and stable — renaming one splits its history in two.
 */
export const LIST_HOMEPAGE = 'Today\u2019s top stories'
export const LIST_ARCHIVE = 'Archive edition'
