/**
 * A JSON-LD block.
 *
 * `<` is escaped to its unicode form so a headline containing markup can never
 * close the script tag early — the payload is site-authored, but it passes
 * through model output on the way here.
 */
export default function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}
