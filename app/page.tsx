import { getTodaysArticles, getLatestDate, isDemoMode } from '@/lib/supabase'
import ArticleCard from '@/components/ArticleCard'

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
        <div className="mb-6 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          Demo mode — displaying sample articles. Connect Supabase to show live AI-generated news.
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-800">
          Today&apos;s Top Stories
        </h1>
        <p className="text-sm text-slate-400 mt-1">{displayDate}</p>
      </div>

      <div className="mb-6 px-4 py-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-500 leading-relaxed">
        These {articles.length} stories were selected from SpinDetector&apos;s cluster analysis as
        today&apos;s most widely-reported events. Each article was written by Claude to AP journalistic
        standards, independently fact-checked by Grok, revised based on the critique, and given
        final approval by Claude before publication.
      </div>

      {articles.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <p className="text-sm">No articles available for {displayDate}.</p>
          <p className="text-xs mt-1">The pipeline runs daily at 08:00 EST.</p>
        </div>
      ) : (
        <div>
          {articles.map((article, i) => (
            <ArticleCard key={article.id} article={article} rank={i + 1} />
          ))}
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-slate-100 text-xs text-slate-400 space-y-1">
        <p className="font-medium text-slate-500 uppercase tracking-widest text-xs mb-2">
          About this site
        </p>
        <p>
          Neutral News identifies the five most widely-covered stories of each day by analysing
          which news events are reported across the most outlets on SpinDetector.com.
        </p>
        <p>
          A two-model review process — Claude writes, Grok critiques, Claude revises, Claude
          validates — is designed to catch loaded language, unverifiable claims, and imbalanced
          framing before publication. No human editorial judgment is applied.
        </p>
      </div>
    </div>
  )
}
