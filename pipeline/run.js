/**
 * Neutral News — Daily Article Generation Pipeline
 *
 * Stages:
 *   1. Select a ranked pool of candidate clusters from SpinDetector (by coverage)
 *   2. Claude drafts a neutral, factual article for a cluster
 *   3. Grok reviews for factual accuracy and neutrality → returns critique
 *   4. Claude revises the article; Grok re-scores the revised version
 *   5. Claude performs final validation sign-off
 *   6. If validation fails, revise once more and re-validate
 *   7. Work down the pool until 5 stories pass the strict gate; store them
 *   8. Trigger a Vercel redeploy so the new edition goes live
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
const { storeArticles, updateArticleInPlace, logError } = require('./store')
const {
  getRecentlyPublished,
  findPriorCoverage,
  hasMaterialDevelopment,
  significantWords,
  jaccard,
  LOOKBACK_DAYS,
} = require('./history')

const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'SPINDETECTOR_SUPABASE_URL', 'SPINDETECTOR_SUPABASE_SERVICE_KEY']
const OPTIONAL_ENV = ['XAI_API_KEY', 'NEUTRAL_NEWS_SUPABASE_URL', 'NEUTRAL_NEWS_SUPABASE_SERVICE_KEY', 'VERCEL_DEPLOY_HOOK_URL']

// ── Duplicate-story detection (within a single edition) ──────────────────────
// SpinDetector occasionally produces two clusters for the same real-world event.
// We compare the significant words of a candidate's headline + topic against the
// stories already published and skip anything that overlaps too heavily.
// Cross-day duplication is handled separately, in ./history.

// True if `candidate` covers the same event as any already-published story.
function isDuplicateStory(candidateText, publishedTexts, threshold = 0.5) {
  const cand = significantWords(candidateText)
  return publishedTexts.some(t => jaccard(cand, significantWords(t)) >= threshold)
}

async function processCluster(cluster) {
  console.log(`\n  📰 "${cluster.topicLabel}" (${cluster.outletCount} outlets)`)

  // Step 2: Initial draft
  const draft = await writeDraft(cluster)

  // Step 3: Grok review
  console.log(`   Running Grok fact-check...`)
  const review = await grokReview(draft, cluster)

  let finalArticle = draft

  // Step 4: Revise if issues found
  let publishedReview = review
  if (review.issues?.length > 0 && review.critiqueText) {
    finalArticle = await reviseWithCritique(draft, review.critiqueText)

    // Re-score the REVISED article so the published Grok score reflects what
    // readers actually see — not the pre-revision draft.
    console.log(`   Re-scoring revised article with Grok...`)
    const rescored = await grokReview(finalArticle, cluster)
    console.log(`   Grok score after revision: ${rescored.overallScore}/10 (was ${review.overallScore}/10)`)
    publishedReview = rescored
  } else {
    console.log(`   No issues found — skipping revision`)
  }

  // Step 5: Claude final validation
  console.log(`   Running Claude final validation...`)
  let validation = await claudeFinalValidation(finalArticle, publishedReview)

  // Step 6: If validation fails, revise once more using its feedback, then
  // re-validate — rather than discarding the article outright.
  if (!validation.approved) {
    const notes = [
      validation.validationNotes,
      ...(validation.remainingIssues ?? []),
    ].filter(Boolean).join('\n')

    if (notes) {
      console.log(`   Validation flagged the article — revising once more and re-validating...`)
      finalArticle = await reviseWithCritique(finalArticle, notes)
      publishedReview = await grokReview(finalArticle, cluster)
      validation = await claudeFinalValidation(finalArticle, publishedReview)
      console.log(`   After retry: approved=${validation.approved}, confidence=${validation.confidenceScore}/10`)
    }
  }

  return {
    clusterId: cluster.clusterId,
    topicLabel: cluster.topicLabel,
    outletCount: cluster.outletCount,
    article: finalArticle,
    grokReview: publishedReview,
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

  const date = process.env.PIPELINE_DATE || new Date().toISOString().split('T')[0]
  console.log(`📅 Date: ${date}`)
  const startTime = Date.now()

  // Stage 1: Select a ranked pool of candidate clusters
  console.log('\n🔍 Stage 1 — Selecting candidate story clusters from SpinDetector...')
  let clusters
  try {
    clusters = await selectTopClusters(date)
  } catch (err) {
    console.error(`❌ Cluster selection failed: ${err.message}`)
    await logError(date, `Cluster selection failed: ${err.message}`)
    process.exit(1)
  }

  // Stages 2–6: Work down the ranked pool, keeping only articles that pass the
  // strict validation gate, until we have 5 — backfilling with the next-ranked
  // story whenever one is rejected.
  // Cross-day memory: what we already published in the last week. A story that
  // leads the coverage for days must not become a new article — and a new URL —
  // each morning.
  console.log(`\n📚 Loading the last ${LOOKBACK_DAYS} days of published stories...`)
  const recent = await getRecentlyPublished(date)
  console.log(`   ${recent.length} recent article(s) to check against`)

  const TARGET = 5
  console.log(`\n✍️  Stages 2–6 — Publishing the top ${TARGET} stories that pass validation...`)
  const results = []
  const publishedTexts = [] // headline + topic of each published story, for dedup
  const updatedInPlace = []
  let processed = 0
  for (const cluster of clusters) {
    if (results.length >= TARGET) break
    processed++

    // Cheap pre-check: skip a cluster whose topic already matches a published
    // story, before spending a full write/review/validate cycle on it.
    if (isDuplicateStory(cluster.topicLabel, publishedTexts)) {
      console.log(`   ⎘ Skipping "${cluster.topicLabel}" — same event as an already-published story`)
      continue
    }

    // Have we covered this story in the last week?
    const priorCoverage = findPriorCoverage(cluster, recent)

    try {
      const result = await processCluster(cluster)
      if (!result.validation?.approved) {
        console.log(`   ✗ Rejected by validation — backfilling with next-ranked story`)
        continue
      }

      if (priorCoverage) {
        // A continuing story. Either it has moved on — in which case we refresh
        // the ORIGINAL article at its existing URL — or it has not, and we
        // publish something else instead. Either way we never mint a second URL
        // for the same event.
        const { prior, matchedOn } = priorCoverage
        const { developed, score } = hasMaterialDevelopment(result.article, prior)
        console.log(
          `   ↻ Already covered on ${prior.date} (matched on ${matchedOn}); ` +
          `similarity to that article ${score.toFixed(2)}`
        )

        if (!developed) {
          console.log(`   ⎘ Nothing materially new since ${prior.date} — backfilling with next-ranked story`)
          continue
        }

        try {
          await updateArticleInPlace({ articleId: prior.id, result })
          updatedInPlace.push({ id: prior.id, headline: result.article.headline, priorDate: prior.date })
          console.log(`   ✓ Refreshed article ${prior.id} in place: "${result.article.headline}"`)
        } catch (err) {
          console.error(`   ⚠ In-place update of article ${prior.id} failed: ${err.message}`)
        }
        // Either way this does not occupy one of today's five slots.
        continue
      }

      // Final check on the finished headline — catches same-event stories the
      // topic labels didn't reveal.
      const candidateText = `${result.article.headline} ${result.topicLabel}`
      if (isDuplicateStory(candidateText, publishedTexts)) {
        console.log(`   ⎘ Duplicate of an already-published story — backfilling: "${result.article.headline}"`)
        continue
      }
      results.push(result)
      publishedTexts.push(candidateText)
      console.log(`   ✓ Published ${results.length}/${TARGET}: "${result.article.headline}"`)
    } catch (err) {
      console.error(`   ❌ Failed for "${cluster.topicLabel}": ${err.message} — backfilling`)
      // Continue with remaining clusters
    }
  }

  if (results.length < TARGET) {
    console.log(`   ⚠ Candidate pool exhausted after ${processed} clusters — publishing ${results.length} of ${TARGET}`)
  }

  if (updatedInPlace.length > 0) {
    console.log(`\n   ${updatedInPlace.length} continuing story/stories refreshed at their existing URLs:`)
    updatedInPlace.forEach(u => console.log(`     · article ${u.id} (first ran ${u.priorDate}) — "${u.headline}"`))
  }

  if (results.length === 0 && updatedInPlace.length === 0) {
    const msg = 'No clusters passed validation — no articles generated'
    console.error(`❌ ${msg}`)
    await logError(date, msg)
    process.exit(1)
  }

  // Stage 7: Store
  console.log('\n💾 Stage 7 — Storing articles in Supabase...')
  const elapsedSeconds = (Date.now() - startTime) / 1000
  try {
    await storeArticles({ articles: results, date, elapsedSeconds })
  } catch (err) {
    console.error(`❌ Storage failed: ${err.message}`)
    await logError(date, `Storage failed: ${err.message}`)
    process.exit(1)
  }

  // Stage 8: Trigger a fresh site build so the new articles go live immediately.
  // Set VERCEL_DEPLOY_HOOK_URL (a Vercel Deploy Hook) to enable. Without it the
  // site still refreshes on its own within the hour via ISR revalidation.
  if (process.env.VERCEL_DEPLOY_HOOK_URL) {
    console.log('\n🚀 Triggering Vercel redeploy...')
    try {
      const res = await fetch(process.env.VERCEL_DEPLOY_HOOK_URL, { method: 'POST' })
      console.log(res.ok ? '   ✓ Redeploy triggered' : `   ⚠ Deploy hook returned ${res.status}`)
    } catch (err) {
      console.warn(`   ⚠ Deploy hook failed: ${err.message}`)
    }
  } else {
    console.log('\nℹ VERCEL_DEPLOY_HOOK_URL not set — site refreshes within the hour via ISR')
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n✅ Pipeline complete in ${totalElapsed}s`)
  console.log(`   ${results.length} new stories published (all passed the strict validation gate) from ${processed} candidates reviewed`)
  if (updatedInPlace.length > 0) {
    console.log(`   ${updatedInPlace.length} continuing story/stories refreshed in place rather than republished`)
  }
}

main().catch(err => {
  console.error('\n💥 Unhandled error:', err)
  process.exit(1)
})
