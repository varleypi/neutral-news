import Link from 'next/link'
import { NeutralArticle } from '@/lib/types'
import ValidationBadge from './ValidationBadge'

interface Props {
  article: NeutralArticle
  rank: number
}

export default function ArticleCard({ article, rank }: Props) {
  const publishedTime = new Date(article.published_at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })

  return (
    <article className="border-b border-slate-200 py-6 last:border-0">
      <div className="flex gap-5">
        <div className="flex-shrink-0 w-7 pt-0.5">
          <span className="text-2xl font-light text-slate-300 leading-none">{rank}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="mb-1">
            <span className="text-xs uppercase tracking-widest text-slate-400 font-medium">
              {article.topic_label}
            </span>
          </div>

          <Link href={`/article/${article.id}`} className="group">
            <h2 className="text-xl font-semibold text-slate-900 leading-snug group-hover:text-slate-600 transition-colors">
              {article.headline}
            </h2>
          </Link>

          <p className="mt-2 text-slate-600 text-sm leading-relaxed">
            {article.summary}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <span className="text-xs text-slate-400">
              {article.outlet_count} outlets reporting
            </span>
            <span className="text-xs text-slate-400">
              Published {publishedTime}
            </span>
            <ValidationBadge article={article} compact />
          </div>

          {article.key_facts.length > 0 && (
            <ul className="mt-3 space-y-0.5">
              {article.key_facts.slice(0, 2).map((fact, i) => (
                <li key={i} className="text-xs text-slate-500 flex gap-1.5">
                  <span className="text-slate-300 flex-shrink-0">—</span>
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  )
}
