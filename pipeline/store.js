/**
 * Stage 4 — Store finished articles and pipeline run metadata in Supabase.
 */

const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  const url = process.env.NEUTRAL_NEWS_SUPABASE_URL || process.env.SPINDETECTOR_SUPABASE_URL
  const key = process.env.NEUTRAL_NEWS_SUPABASE_SERVICE_KEY || process.env.SPINDETECTOR_SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase credentials not set')
  return createClient(url, key)
}

async function storeArticles({ articles, date, elapsedSeconds }) {
  const supabase = getSupabase()

  // Upsert articles (idempotent on date + cluster_id)
  const rows = articles.map(a => ({
    date,
    cluster_id: a.clusterId,
    topic_label: a.topicLabel,
    headline: a.article.headline,
    summary: a.article.summary,
    body: a.article.body,
    key_facts: a.article.keyFacts,
    outlet_count: a.outletCount,
    sources_used: a.article.sourcesUsed,
    grok_review_score: a.grokReview?.overallScore ?? null,
    grok_review_issues: a.grokReview?.issues ?? [],
    grok_reviewer: a.grokReview?.reviewer ?? null,
    validation_approved: a.validation?.approved ?? false,
    validation_confidence: a.validation?.confidenceScore ?? null,
    validation_neutrality: a.validation?.neutralityRating ?? null,
    validation_notes: a.validation?.validationNotes ?? null,
    validation_reviewed_at: a.validation?.reviewedAt ?? null,
    published_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('neutral_articles')
    .upsert(rows, { onConflict: 'date,cluster_id' })

  if (error) throw new Error(`Failed to store articles: ${error.message}`)
  console.log(`   Stored ${rows.length} articles`)

  // Log the pipeline run
  const { error: runError } = await supabase
    .from('neutral_pipeline_runs')
    .insert({
      date,
      articles_generated: rows.length,
      elapsed_seconds: Math.round(elapsedSeconds),
      status: 'success',
    })

  if (runError) console.warn(`   ⚠ Failed to log run: ${runError.message}`)
}

async function logError(date, message) {
  try {
    const supabase = getSupabase()
    await supabase.from('neutral_pipeline_runs').insert({
      date: date ?? new Date().toISOString().split('T')[0],
      articles_generated: 0,
      status: 'error',
      error_message: message,
    })
  } catch (e) {
    console.error('Failed to log error to Supabase:', e.message)
  }
}

module.exports = { storeArticles, logError }
