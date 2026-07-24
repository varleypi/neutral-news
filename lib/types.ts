export interface NeutralArticle {
  id: number
  date: string
  cluster_id: string
  topic_label: string
  headline: string
  summary: string
  body: string
  key_facts: string[]
  references: string[]
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
  /**
   * Set when this article covers a story an earlier article already covered.
   * The page then declares that earlier article as its canonical URL and drops
   * out of the sitemap; archive listings still show it, so each day's edition
   * remains an accurate record of what ran.
   */
  canonical_article_id?: number | null
  /** Timestamp of the most recent in-place refresh of a continuing story. */
  last_updated_at?: string | null
  update_count?: number
}
