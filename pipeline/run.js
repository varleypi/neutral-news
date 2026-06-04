/**
 * Neutral News — Daily Article Generation Pipeline
 *
 * Stages:
 *   1. Select top 5 story clusters from SpinDetector Supabase (by outlet coverage)
 *   2. Claude drafts a neutral, factual article for each cluster
 *   3. Grok reviews for factual accuracy and neutrality → returns critique
 *   4. Claude revises the article incorporating Grok's critique
 *   5. Claude performs final validation sign-off
 *   6. Store final articles + validation metadata in Supabase
 *
 * Usage:
 *   node pipeline/run.js                           # today's date
 *   PIPELINE_DATE=2026-06-01 node pipeline/run.js  # specific date
 *
 * Scheduled via GitHub Actions after SpinDetector pipeline completes (~07:00 EST).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })

const { selectTopClusters } = require('./select')
const { writeDraft, reviseWithCritique } = require('./write')
const { grokReview, claudeFinalValidation } = require('./review')
const { storeArticles, logError } = require('./store')

const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'SPINDETECTOR_SUPABASE_URL', 'SPINDETECTOR_SUPABASE_SERVICE_KEY']
const OPTIONAL_ENV = ['XAI_API_KEY', 'NEUTRAL_NEWS_SUPABASE_URL', 'NEUTRAL_NEWS_SUPABASE_SERVICE_KEY']

async function processCluster(cluster) {
  console.log(`\n  📰 "${cluster.topicLabel}" (${cluster.outletCount} outlets)`)

  // Step 2: Initial draft
  const draft = await writeDraft(cluster)

  // Step 3: Grok review
  console.log(`   Running Grok fact-check...`)
  const review = await grokReview(draft, cluster)

  let finalArticle = draft

  // Step 4: Revise if issues found
  if (review.issues?.length > 0 && review.critiqueText) {
    finalArticle = await reviseWithCritique(draft, review.critiqueText)
  } else {
    console.log(`   No issues found — skipping revision`)
  }

  // Step 5: Claude final validation
  console.log(`   Running Claude final validation...`)
  const validation = await claudeFinalValidation(finalArticle, review)

  return {
    clusterId: cluster.clusterId,
    topicLabel: cluster.topicLabel,
    outletCount: cluster.outletCount,
    article: finalArticle,
    grokReview: review,
    validation,
  }
}

async function main() {
  console.log('\n📰 NEUTRAL NEWS — DAILY PIPELINE')
  console.log('═'.repeat(48))

  const missing = REQUIRED_ENV.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  const missingOptional = OPTIONAL_ENV.filter(k => !process.env[k])
  if (missingOptional.length > 0) {
    console.log(`ℹ Optional env vars not set: ${missingOptional.join(', ')}`)
  }

  const date = process.env.PIPELINE_DATE ?? new Date().toISOString().split('T')[0]
  console.log(`📅 Date: ${date}`)
  const startTime = Date.now()

  // Stage 1: Select top clusters
  console.log('\n🔍 Stage 1 — Selecting top story clusters from SpinDetector...')
  let clusters
  try {
    clusters = await selectTopClusters(date)
  } catch (err) {
    console.error(`❌ Cluster selection failed: ${err.message}`)
    await logError(date, `Cluster selection failed: ${err.message}`)
    process.exit(1)
  }

  // Stages 2–5: Write, review, revise, validate
  console.log('\n✍️  Stages 2–5 — Writing, reviewing, and validating articles...')
  const results = []
  for (const cluster of clusters) {
    try {
      const result = await processCluster(cluster)
      results.push(result)
    } catch (err) {
      console.error(`   ❌ Failed for "${cluster.topicLabel}": ${err.message}`)
      // Continue with remaining clusters
    }
  }

  if (results.length === 0) {
    const msg = 'All clusters failed — no articles generated'
    console.error(`❌ ${msg}`)
    await logError(date, msg)
    process.exit(1)
  }

  // Stage 6: Store
  console.log('\n💾 Stage 6 — Storing articles in Supabase...')
  const elapsedSeconds = (Date.now() - startTime) / 1000
  try {
    await storeArticles({ articles: results, date, elapsedSeconds })
  } catch (err) {
    console.error(`❌ Storage failed: ${err.message}`)
    await logError(date, `Storage failed: ${err.message}`)
    process.exit(1)
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const approved = results.filter(r => r.validation?.approved).length
  console.log(`\n✅ Pipeline complete in ${totalElapsed}s`)
  console.log(`   ${results.length} articles generated · ${approved} approved · ${results.length - approved} flagged`)
}

main().catch(err => {
  console.error('\n💥 Unhandled error:', err)
  process.exit(1)
})
