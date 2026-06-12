import Link from 'next/link'
import { NeutralArticle } from '@/lib/types'
import ValidationBadge from './ValidationBadge'

interface Props {
  article: NeutralArticle
  rank: number
}

export default function ArticleCard({ article, rank }: Props) {
  return (
    <article className="border-b border-slate-200 py-7 last:border-0">
      <div className="flex gap-5">
        <div className="flex-shrink-0 w-8 pt-1">
          <span className="font-serif text-3xl text-slate-200 leading-none">{rank}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="mb-1.5">
            <span className="text-[11px] uppercase tracking-widest text-slate-400 font-medium">
              {article.topic_label}
            </span>
          </div>

          <Link href={`/article/${article.id}`} className="group">
            <h2 className="font-serif text-2xl text-slate-900 leading-snug group-hover:text-slate-600 transition-colors">
              {article.headline}
            </h2>
          </Link>

          <p className="mt-2.5 text-slate-600 text-sm leading-relaxed">
            {article.summary}
          </p>

          <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-xs text-slate-400">
              {article.outlet_count} outlets reporting
            </span>
            <ValidationBadge article={article} compact />
          </div>
        </div>
      </div>
    </article>
  )
}
