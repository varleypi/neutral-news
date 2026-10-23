import { ImageResponse } from 'next/og'
import { SITE_NAME } from '@/lib/site'

/**
 * The publisher logo named by the site's structured data.
 *
 * Google wants a rasterised logo it can place in news surfaces, no wider than
 * 600px and no taller than 60px. Generating it keeps the wordmark in one place
 * — the site's own type — instead of committing a binary that drifts from it.
 */
export const revalidate = 86400

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
          color: '#0f172a',
          fontSize: 38,
          letterSpacing: '-0.5px',
        }}
      >
        {SITE_NAME}
      </div>
    ),
    {
      width: 600,
      height: 60,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    }
  )
}
