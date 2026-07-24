import { getRecentArticles } from '@/lib/supabase'
import { SITE_URL } from '@/lib/site'

// Served at /rss.xml. Consumed by Spin Detector (and any reader) to pull the
// latest neutral summaries. Regenerated hourly.
export const revalidate = 3600

const BASE = SITE_URL

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function GET() {
  const articles = await getRecentArticles(20)

  const items = articles
    .map((a) => {
      const url = `${BASE}/article/${a.id}`
      const when = a.published_at || a.date
      const pubDate = when ? new Date(when).toUTCString() : new Date().toUTCString()
      return `    <item>
      <title>${esc(a.headline)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${esc(a.summary)}</description>
      <pubDate>${pubDate}</pubDate>
    </item>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Neutral News</title>
    <link>${BASE}</link>
    <description>AI-reviewed, neutral summaries of the day's biggest news stories.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
