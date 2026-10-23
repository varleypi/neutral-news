/**
 * Article URLs.
 *
 * Articles live at `/article/<headline-slug>-<id>`. The numeric id stays on the
 * end because it, not the slug, is what the lookup keys on: a re-worded
 * headline changes the slug without orphaning the page, and two stories that
 * slugify to the same words can never collide. Anything that arrives with the
 * wrong slug — including the bare `/article/902` URLs the site used to serve —
 * is 308-redirected to the current one, so exactly one URL per story is
 * indexable.
 */

/** Longest slug we emit, before the `-<id>` suffix. */
const MAX_SLUG_LENGTH = 72

export interface Sluggable {
  id: number
  headline: string
}

/** Lowercase, hyphenated, ASCII-only form of a headline. */
export function slugify(headline: string): string {
  const words = String(headline ?? '')
    // Split accented letters into letter + combining mark, then drop the marks,
    // so "Bogotá" becomes "bogota" rather than losing the letter entirely.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // Elide apostrophes instead of breaking on them: "Trump's" -> "trumps".
    .replace(/['\u2018\u2019\u02bc`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (words.length <= MAX_SLUG_LENGTH) return words

  // Cut at a word boundary so a truncated slug never ends mid-word.
  const cut = words.slice(0, MAX_SLUG_LENGTH + 1)
  const lastBoundary = cut.lastIndexOf('-')
  return (lastBoundary > 0 ? cut.slice(0, lastBoundary) : cut.slice(0, MAX_SLUG_LENGTH)).replace(
    /-+$/,
    ''
  )
}

/** The `[slug]` segment for an article, e.g. `senate-passes-budget-bill-902`. */
export function articleSlug(article: Sluggable): string {
  const slug = slugify(article.headline)
  return slug ? `${slug}-${article.id}` : String(article.id)
}

/** Site-relative path for an article, e.g. `/article/senate-passes-bill-902`. */
export function articlePath(article: Sluggable): string {
  return `/article/${articleSlug(article)}`
}

/**
 * The article id encoded in a `[slug]` segment, or null if there isn't one.
 *
 * Accepts both the current form (`headline-words-902`) and the bare numeric
 * form the site published before slugs existed (`902`).
 */
export function parseArticleParam(param: string): number | null {
  // Long enough for any slug we emit; anything beyond it is not one of ours.
  if (typeof param !== 'string' || param.length > 200) return null

  // The prefix must look like a slug we would actually emit: alphanumeric
  // words joined by single hyphens. That keeps `/article/-1` and friends from
  // resolving to a real story through a redirect.
  const match = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?(\d{1,15})$/.exec(param)
  if (!match) return null

  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
