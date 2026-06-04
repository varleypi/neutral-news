import { NeutralArticle } from '@/lib/types'

interface Props {
  article: NeutralArticle
  compact?: boolean
}

const neutralityColor = {
  'Excellent': 'text-emerald-700',
  'Good': 'text-blue-700',
  'Acceptable': 'text-amber-700',
  'Needs Revision': 'text-red-700',
}

export default function ValidationBadge({ article, compact = false }: Props) {
  const { validation_approved, validation_confidence, validation_neutrality, grok_review_score, grok_reviewer } = article

  if (!validation_approved) return null

  const color = neutralityColor[validation_neutrality ?? 'Good'] ?? 'text-slate-600'

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <CheckIcon />
          Fact-checked by Claude + {grok_reviewer === 'grok' ? 'Grok' : 'Claude'}
        </span>
        {validation_confidence && (
          <span className={`font-medium ${color}`}>
            {validation_neutrality}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="border border-slate-200 rounded p-4 bg-slate-50 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-slate-800">AI Editorial Validation</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Neutrality</div>
          <div className={`font-semibold ${color}`}>{validation_neutrality}</div>
        </div>
        {validation_confidence && (
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Confidence</div>
            <div className="font-semibold text-slate-800">{validation_confidence.toFixed(1)}/10</div>
          </div>
        )}
        {grok_review_score && (
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Grok Score</div>
            <div className="font-semibold text-slate-800">{grok_review_score.toFixed(1)}/10</div>
          </div>
        )}
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Reviewers</div>
          <div className="font-semibold text-slate-800">
            Claude + {grok_reviewer === 'grok' ? 'Grok' : 'Claude'}
          </div>
        </div>
      </div>

      {article.validation_notes && (
        <p className="text-xs text-slate-500 italic border-t border-slate-200 pt-2">
          {article.validation_notes}
        </p>
      )}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}
