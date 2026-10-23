import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getArticle, getTodaysArticles, getLatestDate } from '@/lib/supabase'
import { canonical, alternatesFor, SITE_NAME } from '@/lib/site'
import { articlePath, articleSlug, parseArticleParam } from '@/lib/slug'
import { breadcrumbSchema, newsArticleSchema, ogImagePath } from '@/lib/schema'
import JsonLd from '@/components/JsonLd'
import ArticleDetail from '@/components/ArticleDetail'

export const revalidate = 3600

function editionLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export async function generateStaticParams() {
  const date = await getLatestDate()
  const articles = await getTodaysArticles(date)
  return articles.map(a => ({ slug: articleSlug(a) }))
}

/**
 * The article a URL should ultimately resolve to.
 *
 * Articles written before the pipeline had cross-day memory can duplicate an
 * earlier story; those name the original as their canonical. Resolving it to a
 * full article — not just its id — is what lets the canonical tag point at the
 * original's slug URL. A canonical that pointed at the bare `/article/<id>`
 * form would be a URL that redirects, which is a weak signal to a crawler.
 */
async function resolveCanonicalPath(id: number): Promise<string | null> {
  const original = await getArticle(id)
  return original ? articlePath(original) : null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const id = parseArticleParam(slug)
  if (id === null) return {}

  const article = await getArticle(id)
  if (!article) return {}

  const path = article.canonical_article_id
    ? ((await resolveCanonicalPath(article.canonical_article_id)) ?? articlePath(article))
    : articlePath(article)

  const image = canonical(ogImagePath(article))

  return {
    title: `${article.headline} — ${SITE_NAME}`,
    description: article.summary,
    alternates: alternatesFor(path),
    openGraph: {
      title: article.headline,
      description: article.summary,
      type: 'article',
      url: canonical(path),
      siteName: SITE_NAME,
      publishedTime: article.published_at || undefined,
      modifiedTime: article.last_updated_at || undefined,
      section: article.topic_label,
      images: [{ url: image, width: 1200, height: 630, alt: article.headline }],
    },
    twitter: {
      card: 'summary_large_image',
      title: article.headline,
      description: article.summary,
      images: [image],
    },
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const id = parseArticleParam(slug)
  if (id === null) notFound()

  const article = await getArticle(id)
  if (!article) notFound()

  // Two kinds of URL land here with the wrong slug: the bare `/article/902`
  // links the site published before slugs existed, and slugs left over from an
  // earlier wording of the headline. Both are sent on permanently, so old links
  // keep working and crawlers converge on one URL per story.
  const currentSlug = articleSlug(article)
  if (slug !== currentSlug) permanentRedirect(`/article/${currentSlug}`)

  const originalPath = article.canonical_article_id
    ? await resolveCanonicalPath(article.canonical_article_id)
    : null

  // The story sits under the edition it ran in, which is how the archive is
  // organised and how a reader reaches it without the homepage.
  const trail = breadcrumbSchema([
    { name: 'Today', path: '/' },
    { name: 'Archive', path: '/archive' },
    { name: editionLabel(article.date), path: `/archive/${article.date}` },
    { name: article.headline, path: articlePath(article) },
  ])

  return (
    <>
      <JsonLd data={newsArticleSchema(article, originalPath)} />
      <JsonLd data={trail} />
      <ArticleDetail article={article} originalPath={originalPath} />
    </>
  )
}
