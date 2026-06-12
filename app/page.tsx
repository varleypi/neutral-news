import { getTodaysArticles, getLatestDate, isDemoMode } from '@/lib/supabase'
import ArticleCard from '@/components/ArticleCard'
import AdSlot from '@/components/AdSlot'

export const revalidate = 3600 // revalidate every hour

export default async function HomePage() {
  const date = await getLatestDate()
  const articles = await getTodaysArticles(date)

  const displayDate = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div>
      {isDemoMode && (
        <div className="mb-8 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Demo mode — displaying sample articles. Connect Supabase to show live AI-generated news.
        </div>
      )}

      <div className="mb-8 flex items-baseline justify-between border-b border-slate-200 pb-3">
        <h2 className="font-serif text-2xl text-slate-900">Today&apos;s Top Stories</h2>
        <span className="text-xs text-slate-400">{displayDate}</span>
      </div>

      {articles.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          <p className="text-sm">No articles available for {displayDate}.</p>
          <p className="text-xs mt-1">The next edition publishes at 08:00 EST.</p>
        </div>
      ) : (
        <div>
          {articles.map((article, i) => (
            <div key={article.id}>
              <ArticleCard article={article} rank={i + 1} />
              {i === 1 && <AdSlot slot="home-infeed" format="horizontal" />}
            </div>
          ))}
        </div>
      )}

      <AdSlot slot="home-footer" format="horizontal" />

      <div className="mt-12 pt-6 border-t border-slate-100 text-xs text-slate-400 leading-relaxed">
        <p>
          Stories are selected by breadth of coverage across major outlets, written from verifiable
          facts only, independently fact-checked, and validated before publication.{' '}
          <a href="/about" className="underline decoration-slate-300 underline-offset-2 hover:text-slate-600">
            Read our full methodology
          </a>
          .
        </p>
      </div>
    </div>
  )
}
