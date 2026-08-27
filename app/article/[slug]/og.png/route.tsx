import { ImageResponse } from 'next/og'
import { getArticle } from '@/lib/supabase'
import { parseArticleParam } from '@/lib/slug'
import { OG_SIZE, OgCard } from '@/lib/og'

// Served at /article/<slug>/og.png — the card for one story. Regenerated on the
// same hourly cadence as the article page it belongs to.
export const revalidate = 3600

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const id = parseArticleParam(slug)
  const article = id === null ? null : await getArticle(id)

  // A scraper that asks for a card we cannot build gets the generic one rather
  // than a 404 — a missing image is what makes a shared link look broken.
  const card = article
    ? <OgCard headline={article.headline} kicker={article.topic_label} />
    : <OgCard headline="Five top stories. Zero spin." kicker="Today's edition" />

  return new ImageResponse(card, {
    ...OG_SIZE,
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
