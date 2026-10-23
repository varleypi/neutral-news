import { SITE_NAME } from './site'

/** Facebook, X, LinkedIn and Google Discover all read a 1.91:1 card. */
export const OG_SIZE = { width: 1200, height: 630 }

const INK = '#0f172a'
const MUTED = '#64748b'
const RULE = '#e2e8f0'

/**
 * Headline size, chosen from its length.
 *
 * Satori has no text measurement to auto-fit against, so the size steps down as
 * the headline grows. The steps are picked so the longest headline the pipeline
 * produces still clears the bottom rule.
 */
function headlineSize(headline: string): number {
  if (headline.length <= 45) return 72
  if (headline.length <= 75) return 60
  if (headline.length <= 110) return 50
  return 42
}

function clamp(text: string, max: number): string {
  const trimmed = String(text ?? '').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

/**
 * The shared social card: masthead, rule, headline, standards line.
 *
 * Deliberately typeset in the renderer's built-in face rather than the site's
 * Lora/Inter. Loading a webfont here would put a network fetch between a
 * crawler and the image, and a card that fails to render is worse than one set
 * in the wrong typeface.
 */
export function OgCard({ kicker, headline }: { kicker?: string; headline: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#ffffff',
        padding: '56px 64px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            fontSize: 40,
            letterSpacing: '-0.5px',
            color: INK,
          }}
        >
          {SITE_NAME}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 20,
            width: '100%',
            height: 3,
            backgroundColor: INK,
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'center' }}>
        {kicker ? (
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              letterSpacing: '4px',
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 20,
            }}
          >
            {clamp(kicker, 60)}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            fontSize: headlineSize(headline),
            lineHeight: 1.18,
            color: INK,
          }}
        >
          {clamp(headline, 150)}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', width: '100%', height: 1, backgroundColor: RULE }} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 20,
            fontSize: 21,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          <div style={{ display: 'flex' }}>Factual · Verified · Unbiased</div>
          <div style={{ display: 'flex' }}>neutralnews.us</div>
        </div>
      </div>
    </div>
  )
}
