import { NeutralArticle } from './types'
import { articlePath } from './slug'
import {
  CONTACT_EMAIL,
  LOGO_PATH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  canonical,
} from './site'

/** Google truncates `headline` past this and warns about longer values. */
const MAX_HEADLINE = 110

/** Site-relative path of an article's generated social card. */
export function ogImagePath(article: { id: number; headline: string }): string {
  return `${articlePath(article)}/og.png`
}

function iso(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function clamp(text: string, max: number): string {
  const trimmed = String(text ?? '').trim()
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max - 1)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > max / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`
}

const publisher = {
  '@type': 'NewsMediaOrganization',
  '@id': `${SITE_URL}/#publisher`,
  name: SITE_NAME,
  url: SITE_URL,
  email: CONTACT_EMAIL,
  description: SITE_DESCRIPTION,
  logo: {
    '@type': 'ImageObject',
    url: canonical(LOGO_PATH),
    width: 600,
    height: 60,
  },
  // Both reviewers are named on the About page; declaring the process here is
  // what a news aggregator looks for when deciding whether a publication has
  // one at all.
  publishingPrinciples: canonical('/about'),
  ethicsPolicy: canonical('/about'),
  diversityPolicy: canonical('/about'),
  actionableFeedbackPolicy: canonical('/about'),
  correctionsPolicy: canonical('/about'),
}

/** Publisher + site identity, emitted once from the root layout. */
export function siteSchema() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      publisher,
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: 'en-US',
        publisher: { '@id': `${SITE_URL}/#publisher` },
      },
    ],
  }
}

/**
 * NewsArticle markup for one story.
 *
 * `canonicalPath` is set when this article duplicates an earlier one; the
 * markup then describes the original's URL, matching the canonical tag rather
 * than contradicting it.
 */
export function newsArticleSchema(article: NeutralArticle, canonicalPath?: string | null) {
  const path = canonicalPath ?? articlePath(article)
  const url = canonical(path)
  const published = iso(article.published_at) ?? iso(`${article.date}T12:00:00Z`)
  const modified = iso(article.last_updated_at) ?? published

  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    '@id': `${url}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    headline: clamp(article.headline, MAX_HEADLINE),
    description: article.summary,
    articleSection: article.topic_label,
    inLanguage: 'en-US',
    isAccessibleForFree: true,
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
    image: [
      {
        '@type': 'ImageObject',
        url: canonical(ogImagePath(article)),
        width: 1200,
        height: 630,
      },
    ],
    // Every article is written by the pipeline, not a person. Naming the
    // organisation is the honest form of this field.
    // Named in full rather than referenced by `@id` alone. Both nodes are also
    // defined by the site graph in the layout, but a validator that reads this
    // block on its own should still see who wrote and published the story.
    author: publisher,
    publisher,
    ...(article.topic_label ? { about: { '@type': 'Thing', name: article.topic_label } } : {}),
  }
}

/** Trail of ancestors for a page, so search results can show the path to it. */
export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: canonical(crumb.path),
    })),
  }
}
