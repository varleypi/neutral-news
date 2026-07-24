import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getArticlesByDate, getArchiveDays } from '@/lib/supabase'
import { canonical } from '@/lib/site'
import ArticleCard from '@/components/ArticleCard'

export const revalidate = 3600

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function formatDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export async function generateStaticParams() {
  const days = await getArchiveDays()
  return days.map(d => ({ date: d.date }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>
}): Promise<Metadata> {
  const { date } = await params
  if (!DATE_RE.test(date)) return {}

  return {
    title: `${formatDate(date)} — Neutral News`,
    description: `The five most widely reported stories of ${formatDate(date)}, written neutrally and independently fact-checked.`,
    alternates: { canonical: canonical(`/archive/${date}`) },
  }
}

export default async function ArchiveDatePage({
  params,
}: {
  params: Promise<{ date: string }>
}) {
  const { date } = await params
  if (!DATE_RE.test(date)) notFound()

  const articles = await getArticlesByDate(date)
  if (articles.length === 0) notFound()

  // Neighbouring editions, so a crawler (and a reader) can walk the archive
  // continuously rather than bouncing back to the index each time.
  const days = await getArchiveDays()
  const index = days.findIndex(d => d.date === date)
  const newer = index > 0 ? days[index - 1] : null
  const older = index >= 0 && index < days.length - 1 ? days[index + 1] : null

  return (
    <div>
      <Link
        href="/archive"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-8"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Archive
      </Link>

      <div className="mb-8 flex items-baseline justify-between border-b border-slate-200 pb-3">
        <h1 className="font-serif text-2xl text-slate-900">Top Stories</h1>
        <span className="text-xs text-slate-400">{formatDate(date)}</span>
      </div>

      <div>
        {articles.map((article, i) => (
          <ArticleCard key={article.id} article={article} rank={i + 1} />
        ))}
      </div>

      <nav className="mt-12 pt-6 border-t border-slate-200 flex items-center justify-between gap-4 text-sm">
        {older ? (
          <Link href={`/archive/${older.date}`} className="text-slate-500 hover:text-slate-900 transition-colors">
            ← {formatDate(older.date)}
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link href={`/archive/${newer.date}`} className="text-slate-500 hover:text-slate-900 transition-colors text-right">
            {formatDate(newer.date)} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  )
}
