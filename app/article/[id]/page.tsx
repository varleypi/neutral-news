import { notFound } from 'next/navigation'
import { getArticle, getTodaysArticles, getLatestDate } from '@/lib/supabase'
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
  return {
    title: `${article.headline} — Neutral News`,
    description: article.summary,
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const article = await getArticle(Number(id))
  if (!article) notFound()

  return <ArticleDetail article={article} />
}
