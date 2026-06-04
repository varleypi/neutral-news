export interface NeutralArticle {
  id: number
  date: string
  cluster_id: string
  topic_label: string
  headline: string
  summary: string
  body: string
  key_facts: string[]
  outlet_count: number
  sources_used: string[]
  grok_review_score: number | null
  grok_reviewer: string | null
  validation_approved: boolean
  validation_confidence: number | null
  validation_neutrality: 'Excellent' | 'Good' | 'Acceptable' | 'Needs Revision' | null
  validation_notes: string | null
  validation_reviewed_at: string | null
  published_at: string
}
