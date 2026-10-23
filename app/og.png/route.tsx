import { ImageResponse } from 'next/og'
import { OG_SIZE, OgCard } from '@/lib/og'

// The default social card. Its content never changes, so it is prerendered once
// and refreshed a day at a time.
export const revalidate = 86400

export async function GET() {
  return new ImageResponse(
    <OgCard headline="Five top stories. Zero spin." kicker="Today's edition" />,
    {
      ...OG_SIZE,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    }
  )
}
