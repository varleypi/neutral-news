import { getRecentArticles } from '@/lib/supabase'
import { articlePath } from '@/lib/slug'
import { escapeXml, w3cDate } from '@/lib/xml'
import { SITE_NAME, canonical } from '@/lib/site'

/**
 * Served at /news-sitemap.xml — the Google News sitemap.
 *
 * Separate from /sitemap.xml because Google News reads a different document to
 * the general crawler: only articles published in the last two days belong in
 * it, and each entry carries the publication name, language and headline. A
 * regular sitemap listing every article ever published is the wrong shape for
 * it, and an oversized one is ignored.
 *
 * Registered in robots.txt, and the file Publisher Center is pointed at.
 */
export const revalidate = 900

/** Google drops anything older than 48 hours from a news sitemap. */
const MAX_AGE_MS = 48 * 60 * 60 * 1000

/** Google's own cap for this file. Five stories a day never approaches it. */
const MAX_ENTRIES = 1000

export async function GET() {
  const { articles, ok } = await getRecentArticles(MAX_ENTRIES)

  // As with the feed: an empty sitemap is a claim that nothing was published,
  // which is worse than briefly serving the previous one from cache.
  if (!ok) throw new Error('news-sitemap.xml: could not read recent articles')

  const cutoff = Date.now() - MAX_AGE_MS

  const entries = articles
    .map(article => ({
      article,
      published: w3cDate(article.published_at) ?? w3cDate(`${article.date}T12:00:00Z`),
    }))
    .filter(
      ({ article, published }) =>
        article.headline && published && new Date(published).getTime() >= cutoff
    )
    .map(({ article, published }) =>
      [
        '  <url>',
        `    <loc>${escapeXml(canonical(articlePath(article)))}</loc>`,
        '    <news:news>',
        '      <news:publication>',
        `        <news:name>${escapeXml(SITE_NAME)}</news:name>`,
        '        <news:language>en</news:language>',
        '      </news:publication>',
        `      <news:publication_date>${escapeXml(published)}</news:publication_date>`,
        `      <news:title>${escapeXml(article.headline)}</news:title>`,
        '    </news:news>',
        '  </url>',
      ].join('\n')
    )

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries.join('\n')}
</urlset>
`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control':
        'public, max-age=600, s-maxage=900, stale-while-revalidate=86400, stale-if-error=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
