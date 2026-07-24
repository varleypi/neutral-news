/**
 * Stage 4 — Store finished articles and pipeline run metadata in Supabase.
 */

const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

function getSupabase() {
  const url = process.env.NEUTRAL_NEWS_SUPABASE_URL || process.env.SPINDETECTOR_SUPABASE_URL
  const key = process.env.NEUTRAL_NEWS_SUPABASE_SERVICE_KEY || process.env.SPINDETECTOR_SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase credentials not set')
  return createClient(url, key, {
    realtime: { transport: ws },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function storeArticles({ articles, date, elapsedSeconds }) {
  const supabase = getSupabase()

  // Every candidate may have been a continuing story refreshed in place, which
  // leaves no new rows for today. Pruning on an empty cluster list would build
  // an `in ()` filter and wipe the day, so log the run and stop here.
  if (articles.length === 0) {
    console.log('   No new articles for this date — nothing to store or prune')
    const { error: emptyRunError } = await supabase
      .from('neutral_pipeline_runs')
      .insert({
        date,
        articles_generated: 0,
        elapsed_seconds: Math.round(elapsedSeconds),
        status: 'success',
      })
    if (emptyRunError) console.warn(`   ⚠ Failed to log run: ${emptyRunError.message}`)
    return
  }

  // Upsert articles (idempotent on date + cluster_id)
  const rows = articles.map(a => ({
    date,
    cluster_id: a.clusterId,
    topic_label: a.topicLabel,
    headline: a.article.headline,
    summary: a.article.summary,
    body: a.article.body,
    key_facts: a.article.keyFacts,
    references: a.article.references ?? [],
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

  // Replace-not-accumulate: remove any rows for this date left over from an
  // earlier run whose clusters aren't in the current edition. This keeps the
  // day's published set equal to exactly this run's output (no stale duplicates).
  const currentClusterIds = rows.map(r => r.cluster_id)
  const inList = `(${currentClusterIds.map(id => `"${id}"`).join(',')})`
  const { error: pruneError, count } = await supabase
    .from('neutral_articles')
    .delete({ count: 'exact' })
    .eq('date', date)
    .not('cluster_id', 'in', inList)

  if (pruneError) console.warn(`   ⚠ Failed to prune stale rows: ${pruneError.message}`)
  else if (count) console.log(`   Pruned ${count} stale article(s) from earlier runs`)

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

/**
 * Refresh a continuing story in place, at its original URL.
 *
 * Used when a candidate turns out to be a story we already published within the
 * lookback window AND the new draft carries genuinely new information. Keeping
 * the original `id` — and therefore the original `/article/{id}` URL and its
 * accumulated search authority — is the whole point: the alternative is a second
 * near-identical page competing with the first.
 *
 * `date` and `published_at` deliberately keep their original values so the
 * article stays in the archive edition where it first ran; `last_updated_at`
 * records the refresh.
 */
async function updateArticleInPlace({ articleId, result }) {
  const supabase = getSupabase()

  const { data: existing, error: readError } = await supabase
    .from('neutral_articles')
    .select('update_count')
    .eq('id', articleId)
    .single()

  if (readError) throw new Error(`Failed to read article ${articleId}: ${readError.message}`)

  const { error } = await supabase
    .from('neutral_articles')
    .update({
      topic_label: result.topicLabel,
      headline: result.article.headline,
      summary: result.article.summary,
      body: result.article.body,
      key_facts: result.article.keyFacts,
      references: result.article.references ?? [],
      outlet_count: result.outletCount,
      sources_used: result.article.sourcesUsed,
      grok_review_score: result.grokReview?.overallScore ?? null,
      grok_review_issues: result.grokReview?.issues ?? [],
      grok_reviewer: result.grokReview?.reviewer ?? null,
      validation_approved: result.validation?.approved ?? false,
      validation_confidence: result.validation?.confidenceScore ?? null,
      validation_neutrality: result.validation?.neutralityRating ?? null,
      validation_notes: result.validation?.validationNotes ?? null,
      validation_reviewed_at: result.validation?.reviewedAt ?? null,
      last_updated_at: new Date().toISOString(),
      update_count: (existing?.update_count ?? 0) + 1,
    })
    .eq('id', articleId)

  if (error) throw new Error(`Failed to update article ${articleId}: ${error.message}`)
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

module.exports = { storeArticles, updateArticleInPlace, logError }
