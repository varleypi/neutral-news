/**
 * XML text helpers shared by /rss.xml and /news-sitemap.xml.
 *
 * Article text reaches these feeds straight from the generation pipeline, so it
 * can carry anything a language model emitted — smart quotes, a stray control
 * byte, an unpaired surrogate from a truncated write. Any one of those makes the
 * document ill-formed, and a feed reader's response to ill-formed XML is to drop
 * the whole feed, not the one bad item. Everything is scrubbed on the way out.
 */

/**
 * Strip the code points XML 1.0 does not allow at all.
 *
 * That is the C0 controls except tab, newline and carriage return, plus the
 * lone surrogates that survive a byte-truncated string.
 */
function stripInvalid(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
}

/** Escape a string for use as XML element text or an attribute value. */
export function escapeXml(value: unknown): string {
  return stripInvalid(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Wrap markup in CDATA.
 *
 * `]]>` is the one sequence that cannot appear inside a CDATA section; it is
 * split across two sections rather than escaped, which is the only way to keep
 * the payload byte-identical.
 */
export function cdata(value: unknown): string {
  return `<![CDATA[${stripInvalid(String(value ?? '')).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

/** RFC 822 date for RSS, or null if the input isn't a usable timestamp. */
export function rfc822(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toUTCString()
}

/** W3C datetime for sitemaps, or null if the input isn't a usable timestamp. */
export function w3cDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
