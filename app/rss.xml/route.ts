import { NeutralArticle } from '@/lib/types'
import { getRecentArticles } from '@/lib/supabase'
import { articlePath } from '@/lib/slug'
import { ogImagePath } from '@/lib/schema'
import { cdata, escapeXml, rfc822 } from '@/lib/xml'
import {
  CONTACT_EMAIL,
  RSS_PATH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  canonical,
} from '@/lib/site'

/**
 * Served at /rss.xml. Consumed by Spin Detector (and any reader) to pull the
 * latest neutral summaries.
 *
 * Three things keep this feed stable enough for a machine to depend on:
 *
 *   - It never publishes an empty or half-built feed. A failed read throws
 *     rather than returning zero items, which leaves the last good feed in the
 *     route cache for the CDN to keep serving while the next revalidation
 *     retries. Silently serving an empty channel would read, to a subscriber,
 *     as the publication going quiet.
 *   - Its bytes only change when its content does. `lastBuildDate` comes from
 *     the newest item rather than the clock, so an unchanged feed regenerates
 *     to an identical document and conditional requests stay meaningful.
 *   - Item identity is fixed. `guid` stays the id-based URL the feed has always
 *     used, now declared as a non-permalink, so moving articles to headline
 *     slugs changes where `<link>` points without re-delivering every item to
 *     every existing subscriber.
 */
export const revalidate = 3600

const FEED_LIMIT = 25

/** Ranked newest-first, using whatever timestamp the row actually has. */
function publishedAt(article: NeutralArticle): string | null {
  return rfc822(article.published_at) ?? rfc822(`${article.date}T12:00:00Z`)
}

function sortKey(article: NeutralArticle): number {
  const when = publishedAt(article)
  return when ? new Date(when).getTime() : 0
}

/** The article body as HTML, for readers that render `content:encoded`. */
function contentHtml(article: NeutralArticle): string {
  const parts: string[] = []

  if (article.key_facts?.length) {
    const facts = article.key_facts.map(fact => `<li>${escapeXml(fact)}</li>`).join('')
    parts.push(`<h2>Key facts</h2><ul>${facts}</ul>`)
  }

  for (const paragraph of String(article.body ?? '').split('\n\n')) {
    if (paragraph.trim()) parts.push(`<p>${escapeXml(paragraph.trim())}</p>`)
  }

  if (article.references?.length) {
    const refs = article.references.map(ref => `<li>${escapeXml(ref)}</li>`).join('')
    parts.push(`<h2>References</h2><ol>${refs}</ol>`)
  }

  parts.push(
    `<p><a href="${escapeXml(canonical(articlePath(article)))}">Read this story on ${escapeXml(SITE_NAME)}</a></p>`
  )

  return parts.join('')
}

function item(article: NeutralArticle): string {
  const url = canonical(articlePath(article))
  // The permanent identity of the item. Never rebuilt from the headline: a
  // re-worded headline must not look like a new story to a subscriber.
  const guid = `${SITE_URL}/article/${article.id}`
  const pubDate = publishedAt(article)

  return [
    '    <item>',
    `      <title>${escapeXml(article.headline)}</title>`,
    `      <link>${escapeXml(url)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(guid)}</guid>`,
    pubDate ? `      <pubDate>${escapeXml(pubDate)}</pubDate>` : null,
    `      <description>${escapeXml(article.summary)}</description>`,
    `      <content:encoded>${cdata(contentHtml(article))}</content:encoded>`,
    article.topic_label ? `      <category>${escapeXml(article.topic_label)}</category>` : null,
    `      <dc:creator>${escapeXml(SITE_NAME)}</dc:creator>`,
    `      <media:content url="${escapeXml(canonical(ogImagePath(article)))}" medium="image" type="image/png" width="1200" height="630" />`,
    '    </item>',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function GET() {
  const { articles, ok } = await getRecentArticles(FEED_LIMIT)

  if (!ok) {
    // Deliberately not a 200 with an empty channel. Throwing keeps the previously
    // generated feed in the route cache, so subscribers keep seeing real items
    // while the next revalidation retries the database.
    throw new Error('rss.xml: could not read recent articles')
  }

  const published = articles
    .filter(article => article.headline && article.summary)
    .sort((a, b) => sortKey(b) - sortKey(a))

  // Derived from the content, not from `new Date()`, so regenerating an
  // unchanged feed produces a byte-identical document.
  const lastBuildDate = published.length ? publishedAt(published[0]) : null

  const channel = [
    `    <title>${escapeXml(SITE_NAME)}</title>`,
    `    <link>${escapeXml(SITE_URL)}</link>`,
    `    <atom:link href="${escapeXml(canonical(RSS_PATH))}" rel="self" type="application/rss+xml" />`,
    `    <description>${escapeXml(SITE_DESCRIPTION)}</description>`,
    '    <language>en-us</language>',
    `    <copyright>© ${escapeXml(SITE_NAME)}</copyright>`,
    `    <managingEditor>${escapeXml(CONTACT_EMAIL)} (${escapeXml(SITE_NAME)})</managingEditor>`,
    `    <webMaster>${escapeXml(CONTACT_EMAIL)} (${escapeXml(SITE_NAME)})</webMaster>`,
    lastBuildDate ? `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>` : null,
    lastBuildDate ? `    <pubDate>${escapeXml(lastBuildDate)}</pubDate>` : null,
    '    <ttl>60</ttl>',
    `    <generator>${escapeXml(SITE_NAME)}</generator>`,
    '    <docs>https://www.rssboard.org/rss-specification</docs>',
  ]
    .filter(Boolean)
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
${channel}
${published.map(item).join('\n')}
  </channel>
</rss>
`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // `stale-if-error` is the header half of the same promise the throw above
      // makes: a proxy that has a copy of this feed should keep handing it out
      // rather than passing an error on to a reader.
      'Cache-Control':
        'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
