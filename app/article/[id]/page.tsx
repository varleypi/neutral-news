import { notFound } from 'next/navigation'
import { getArticle, getTodaysArticles, getLatestDate } from '@/lib/supabase'
import { canonical } from '@/lib/site'
import ArticleDetail from '@/components/ArticleDetail'

export const revalidate = 3600

export async function generateStaticParams() {
  const date = await getLatestDate()
  const articles = await getTodaysArticles(date)
  return articles.map(a => ({ id: String(a.id) }))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const article = await getArticle(Number(id))
  if (!article) return {}
  // Articles published before the pipeline had cross-day memory can duplicate an
  // earlier story. Those point their canonical at the original so crawlers
  // consolidate the pair instead of counting two thin, near-identical pages.
  const canonicalId = article.canonical_article_id ?? article.id

  return {
    title: `${article.headline} — Neutral News`,
    description: article.summary,
    alternates: { canonical: canonical(`/article/${canonicalId}`) },
    openGraph: {
      title: article.headline,
      description: article.summary,
      type: 'article',
      url: canonical(`/article/${canonicalId}`),
      publishedTime: article.published_at || undefined,
      modifiedTime: article.last_updated_at || undefined,
    },
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const article = await getArticle(Number(id))
  if (!article) notFound()

  return <ArticleDetail article={article} />
}
