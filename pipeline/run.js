/**
 * Neutral News — Daily Article Generation Pipeline
 *
 * Stages:
 *   1. Select a ranked pool of candidate clusters from SpinDetector (by coverage)
 *   2. Claude drafts a neutral, factual article for a cluster, with web search
 *   3. Grok reviews for factual accuracy and neutrality → returns critique
 *  3b. Claude verifies the article's standalone claims against live sources
 *   4. Claude revises the article; the review and verification are re-run
 *   5. Claude performs final validation and accounts for each required issue
 *   6. ./gate.js decides — in code — whether the article may publish
 *   7. If the gate blocks, revise once more against the blockers and re-check
 *   8. Work down the pool until 5 stories pass the gate; store them
 *   9. Trigger a Vercel redeploy so the new edition goes live
 *  10. Post the edition to X as a thread (optional, gated on X_* env vars)
 *
 * Usage:
 *   node pipeline/run.js                           # today's date
 *   PIPELINE_DATE=2026-06-01 node pipeline/run.js  # specific date
 *
 * Scheduled via GitHub Actions after SpinDetector pipeline completes (~07:00 EST).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })

const { selectTopClusters } = require('./select')
const { writeDraft, applyCorrections } = require('./write')
const { grokReview, claudeFinalValidation } = require('./review')
const { verifyClaims, verificationIssues } = require('./verify')
const { evaluateGate, describeBlockers, excerptStillPresent } = require('./gate')
const { usageReport } = require('./claude')
const { storeArticles, updateArticleInPlace, logError, hasAttemptedRun } = require('./store')
const { postDailyThread } = require('./social')
const {
  getRecentlyPublished,
  findPriorCoverage,
  hasMaterialDevelopment,
  significantWords,
  jaccard,
  LOOKBACK_DAYS,
} = require('./history')

// ── Pilot / dry-run controls ────────────────────────────────────────────────
// PIPELINE_DRY_RUN=1      run everything, write nothing, publish nothing
// PIPELINE_MAX_CLUSTERS=N stop after N candidates (keeps a pilot cheap)
const DRY_RUN = ['1', 'true', 'yes'].includes(String(process.env.PIPELINE_DRY_RUN ?? '').toLowerCase())
const MAX_CLUSTERS = Number(process.env.PIPELINE_MAX_CLUSTERS) || Infinity

// What a dry run saw, in the order it saw it — printed as a report at the end.
const dryRunReport = []

const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'SPINDETECTOR_SUPABASE_URL', 'SPINDETECTOR_SUPABASE_SERVICE_KEY']
const OPTIONAL_ENV = [
  'XAI_API_KEY',
  'NEUTRAL_NEWS_SUPABASE_URL',
  'NEUTRAL_NEWS_SUPABASE_SERVICE_KEY',
  'VERCEL_DEPLOY_HOOK_URL',
  'X_API_KEY',
  'X_API_SECRET',
  'X_ACCESS_TOKEN',
  'X_ACCESS_SECRET',
]

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

/**
 * Review and verify in parallel - neither depends on the other's output.
 *
 * Grok runs on the first check only. On 2026-10-26 it was the single biggest
 * line item: 36 calls at an average 218,000 input tokens each, $18.51 of a
 * $44.16 run, because every pass re-ran it and every call drags its own search
 * results into context. Its job is auditing neutrality and that reads much the
 * same on the draft as on the corrected version, while facts - the thing
 * corrections actually change - are the verifier's job and still re-run every
 * pass. The Opus validator also judges neutrality on the final text.
 */
async function checkArticle(article, cluster, date, { withGrok = true } = {}) {
  const [review, verification] = await Promise.all([
    withGrok ? grokReview(article, cluster, { date }) : Promise.resolve(EMPTY_REVIEW),
    verifyClaims(article, cluster, { date }),
  ])
  // The verifier's unconfirmed claims join the required-issue queue, so the gate
  // holds them to the same standard as anything the fact-checker raised.
  const issues = [...(review.issues ?? []), ...verificationIssues(verification)]
  return { review: { ...review, issues }, verification }
}

/**
 * Which required issues are still sitting in the article, word for word.
 *
 * Free, and worth running before anything that costs money. In the second pilot
 * the writer was handed four required corrections, returned a visibly unchanged
 * article, and the pipeline spent a fact-check, a verification and a validation
 * finding that out - then spent four more calls retrying. The same answer is
 * available locally by looking at the text.
 */
function unresolvedRequired(article, review) {
  const body = `${article.headline}\n${article.summary}\n${article.body}\n${(article.keyFacts ?? []).join('\n')}`
  return (review.issues ?? []).filter(i => i.severity === 'required' && excerptStillPresent(i.excerpt, body))
}

// Stands in for Grok on later passes: no findings of its own, so the gate sees
// only what the verifier raised.
const EMPTY_REVIEW = { overallScore: null, issues: [], critiqueText: '', reviewer: 'skipped', sourcesConsulted: [] }

async function processCluster(cluster, date) {
  console.log(`\n  📰 "${cluster.topicLabel}" (${cluster.outletCount} outlets)`)

  // Step 2: Initial draft, researched rather than recalled
  let article = await writeDraft(cluster, { date })

  // Steps 3 & 3b: fact-check and claim verification
  console.log(`   Running fact-check and claim verification...`)
  let { review, verification } = await checkArticle(article, cluster, date)

  // Step 4: Apply the required corrections.
  //
  // Not a rewrite request. The model issues one resolution per flagged passage
  // and ./corrections.js performs the edit, because asking for the revised
  // article back is what produced the 2026-10-24 edition: the writer returned
  // the original verbatim, was shown the passages that had not moved, and
  // returned it verbatim again. One story published out of twelve candidates.
  //
  // Suggested issues buy no round trip. Each one used to cost a revision plus
  // a full re-check - three paid calls to polish wording the gate would never
  // have blocked on.
  const required = (review.issues ?? []).filter(i => i.severity === 'required')
  if (required.length > 0) {
    const { article: corrected, unresolved } = await applyCorrections(article, required, { date })
    article = corrected

    // Free, and it checks the article rather than the account of it. After a
    // mechanical edit this should be empty; if it is not, something did not
    // match and the gate will catch it - but we learn it here, for nothing.
    const stillThere = unresolvedRequired(article, review)
    if (stillThere.length > 0 || unresolved.length > 0) {
      console.warn(`   ! ${stillThere.length} flagged passage(s) still in the article after corrections`)
    }

    console.log(`   Re-checking corrected article...`)
    const rechecked = await checkArticle(article, cluster, date, { withGrok: false })
    console.log(`   Score after corrections: ${rechecked.review.overallScore}/10 (was ${review.overallScore}/10)`)
    review = rechecked.review
    verification = rechecked.verification
  } else {
    console.log(`   No required issues - skipping corrections`)
  }

  // Step 5: Final validation - which now reports rather than decides
  console.log(`   Running Claude final validation...`)
  let validation = await claudeFinalValidation(article, review, { verification, date })

  // Step 6: The gate. Code, not prose, decides from here.
  let gate = evaluateGate({ article, review, validation, verification })

  // Step 7: One more attempt. A story that fails twice is dropped and the
  // next-ranked candidate takes its slot.
  if (!gate.passed) {
    console.log(`   Gate blocked the article:`)
    describeBlockers(gate.blockers).forEach(b => console.log(`     . ${b}`))

    const stillRequired = (review.issues ?? []).filter(i => i.severity === 'required')
    if (stillRequired.length > 0) {
      console.log(`   Applying corrections against the blockers...`)
      const { article: corrected } = await applyCorrections(article, stillRequired, { date })
      article = corrected
      const rechecked = await checkArticle(article, cluster, date, { withGrok: false })
      review = rechecked.review
      verification = rechecked.verification
      validation = await claudeFinalValidation(article, review, { verification, date })
      gate = evaluateGate({ article, review, validation, verification })
      console.log(`   After retry: gate ${gate.passed ? 'passed' : 'still blocked'}`)
      if (!gate.passed) describeBlockers(gate.blockers).forEach(b => console.log(`     . ${b}`))
    } else {
      // Nothing excerpt-shaped left to fix - the blocker is structural
      // (verification unavailable, or the validator declining on its own).
      console.log(`   No correctable issues remain - dropping this candidate`)
    }
  }

  return {
    clusterId: cluster.clusterId,
    topicLabel: cluster.topicLabel,
    outletCount: cluster.outletCount,
    article,
    grokReview: review,
    validation,
    verification,
    gate,
  }
}

/**
 * The pilot report.
 *
 * The point of a dry run is to see the gate working, so this leads with the
 * rejections and why they happened - which claims current sources contradicted,
 * which required corrections went unresolved, and which waivers were offered
 * with nothing behind them.
 */
function printDryRunReport(date, processed, elapsedSeconds) {
  const rule = '-'.repeat(72)
  console.log(`
${'='.repeat(72)}`)
  console.log(`DRY RUN REPORT - ${date} - ${processed} cluster(s) in ${elapsedSeconds.toFixed(1)}s`)
  console.log('Nothing was stored, deployed or posted.')
  console.log('='.repeat(72))

  for (const entry of dryRunReport) {
    const { outcome, result, cluster, reason } = entry
    console.log(`
${rule}`)

    // Skipped and errored clusters never reach the gate, so they have no
    // article to describe - but leaving them out of the report, as the first
    // pilot did, makes three clusters look like one.
    if (!result) {
      console.log(`[-] ${outcome.toUpperCase()} - "${cluster?.topicLabel ?? 'unknown cluster'}"`)
      console.log(`   ${reason}`)
      continue
    }

    const mark = outcome === 'rejected' ? 'x' : outcome === 'skipped' ? '-' : 'v'
    console.log(`[${mark}] ${outcome.toUpperCase()} - "${result.article.headline}"`)
    console.log(`   cluster: ${result.topicLabel} (${result.outletCount} outlets)`)
    if (reason) console.log(`   ${reason}`)

    // Which reviewer actually ran matters: a silent fallback means one model
    // checked this article, not two.
    console.log(`   fact-check by: ${result.grokReview?.reviewer ?? 'unknown'}` +
      ` (score ${result.grokReview?.overallScore ?? 'n/a'}/10)`)

    const v = result.verification ?? {}
    console.log(`   verification: ${v.status ?? 'n/a'}` +
      (v.sourcesRetrieved?.length ? ` - ${v.sourcesRetrieved.length} source(s) retrieved` : ''))
    for (const c of v.claims ?? []) {
      if (c.verdict === 'SUPPORTED') continue // the interesting ones are the others
      console.log(`     [${c.verdict}] ${c.claim}`)
      if (c.evidence) console.log(`        -> ${c.evidence}`)
      if (c.sources?.length) console.log(`        -> ${c.sources.join(', ')}`)
    }

    const required = (result.grokReview?.issues ?? []).filter(i => i.severity === 'required')
    if (required.length > 0) {
      console.log(`   required issues raised: ${required.length}`)
      for (const i of required) console.log(`     [${i.type}] "${truncate(i.excerpt, 110)}"`)
    }

    for (const d of result.validation?.requiredIssueDispositions ?? []) {
      console.log(`   disposition: ${d.disposition} (${d.evidenceType ?? 'none'})` +
        (d.evidenceRef ? ` -> ${truncate(d.evidenceRef, 80)}` : ''))
    }

    console.log(`   gate: ${result.gate?.passed ? 'PASSED' : 'BLOCKED'}`)
    for (const b of describeBlockers(result.gate?.blockers ?? [])) {
      console.log(`     . ${b}`)
    }
  }

  const tally = dryRunReport.reduce((acc, e) => ({ ...acc, [e.outcome]: (acc[e.outcome] ?? 0) + 1 }), {})
  const counted = Object.values(tally).reduce((a, b) => a + b, 0)
  console.log(`
${'='.repeat(72)}`)
  console.log(`   ${processed} cluster(s) processed:`)
  for (const [outcome, n] of Object.entries(tally)) console.log(`     ${String(n).padStart(3)}  ${outcome}`)
  if (counted < processed) console.log(`     ${String(processed - counted).padStart(3)}  unaccounted for`)
  console.log('='.repeat(72))
}

function truncate(text, n) {
  const t = String(text ?? '')
  return t.length > n ? `${t.slice(0, n)}...` : t
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

  // A pilot has to be able to exercise the real clusters, the real models and
  // the real gate without any of it reaching readers. In a dry run nothing is
  // stored, no deploy is triggered and nothing is posted — the run prints what
  // it would have published, and why each rejected story was rejected.
  if (DRY_RUN) {
    console.log('🧪 DRY RUN — nothing will be stored, deployed or posted')
    if (Number.isFinite(MAX_CLUSTERS)) console.log(`   Processing at most ${MAX_CLUSTERS} cluster(s)`)
  }
  const startTime = Date.now()

  // The dispatch from SpinDetector and the backup cron can both fire on the same
  // day, and a full run is well over a hundred model calls, so only the first
  // attempt works. Counts failed attempts too: on 2026-10-24 the first run
  // failed after three hours and the backup then ran the same clusters again.
  if (process.env.FORCE_RUN !== 'true' && !DRY_RUN) {
    let alreadyRan = false
    try {
      alreadyRan = await hasAttemptedRun(date)
    } catch (err) {
      console.warn(`   ⚠ ${err.message} — running anyway`)
    }
    if (alreadyRan) {
      console.log(`\n⏭  The ${date} edition was already attempted — skipping (set FORCE_RUN=true to regenerate)`)
      return
    }
  }

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

  // Stages 2–7: Work down the ranked pool, keeping only articles that clear the
  // publication gate, until we have 5 — backfilling with the next-ranked story
  // whenever one is rejected.
  // Cross-day memory: what we already published in the last week. A story that
  // leads the coverage for days must not become a new article — and a new URL —
  // each morning.
  console.log(`\n📚 Loading the last ${LOOKBACK_DAYS} days of published stories...`)
  const recent = await getRecentlyPublished(date)
  console.log(`   ${recent.length} recent article(s) to check against`)

  const TARGET = 5
  console.log(`\n✍️  Stages 2–7 — Publishing the top ${TARGET} stories that clear the gate...`)
  const results = []
  const publishedTexts = [] // headline + topic of each published story, for dedup
  const updatedInPlace = []
  let processed = 0
  // Tells an article that genuinely failed its checks apart from a verifier outage.
  const VERIFIER_FAILURE_LIMIT = 3
  let consecutiveVerifierFailures = 0
  for (const cluster of clusters) {
    if (results.length >= TARGET) break
    if (processed >= MAX_CLUSTERS) {
      console.log(`
   Reached the ${MAX_CLUSTERS}-cluster cap for this run`)
      break
    }
    processed++

    // Cheap pre-check: skip a cluster whose topic already matches a published
    // story, before spending a full write/review/validate cycle on it.
    if (isDuplicateStory(cluster.topicLabel, publishedTexts)) {
      console.log(`   ⎘ Skipping "${cluster.topicLabel}" — same event as an already-published story`)
      if (DRY_RUN) dryRunReport.push({ outcome: 'skipped', reason: 'same event as an already-published story', cluster })
      continue
    }

    // Have we covered this story in the last week?
    const priorCoverage = findPriorCoverage(cluster, recent)

    try {
      const result = await processCluster(cluster, date)
      if (!result.gate?.passed) {
        console.log(`   ✗ Rejected by the publication gate — backfilling with next-ranked story`)
        if (DRY_RUN) dryRunReport.push({ outcome: 'rejected', result })

        // Verification is a hard dependency now: an article whose claims could
        // not be checked does not publish. That is the right default, but if the
        // verifier itself is down, every remaining candidate will fail the same
        // way — so stop rather than spending the whole pool proving it.
        const onlyVerificationFailed =
          result.gate.blockers.length > 0 &&
          result.gate.blockers.every(b => b.kind === 'VERIFICATION_UNAVAILABLE')
        consecutiveVerifierFailures = onlyVerificationFailed ? consecutiveVerifierFailures + 1 : 0

        if (consecutiveVerifierFailures >= VERIFIER_FAILURE_LIMIT) {
          const msg =
            `Claim verification failed on ${consecutiveVerifierFailures} consecutive clusters — ` +
            `aborting rather than publishing unverified articles`
          console.error(`\n❌ ${msg}`)
          await logError(date, msg)
          process.exit(1)
        }
        continue
      }
      consecutiveVerifierFailures = 0

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
          if (DRY_RUN) dryRunReport.push({ outcome: 'skipped', reason: `nothing materially new since ${prior.date}`, cluster, result })
          continue
        }

        if (DRY_RUN) {
          dryRunReport.push({ outcome: 'would refresh in place', priorId: prior.id, result })
          console.log(`   ✓ [dry run] would refresh article ${prior.id} in place: "${result.article.headline}"`)
        } else {
          try {
            await updateArticleInPlace({ articleId: prior.id, result })
            updatedInPlace.push({ id: prior.id, headline: result.article.headline, priorDate: prior.date })
            console.log(`   ✓ Refreshed article ${prior.id} in place: "${result.article.headline}"`)
          } catch (err) {
            console.error(`   ⚠ In-place update of article ${prior.id} failed: ${err.message}`)
          }
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
      if (DRY_RUN) dryRunReport.push({ outcome: 'would publish', result })
      console.log(
        DRY_RUN
          ? `   ✓ [dry run] would publish ${results.length}/${TARGET}: "${result.article.headline}"`
          : `   ✓ Published ${results.length}/${TARGET}: "${result.article.headline}"`
      )
    } catch (err) {
      console.error(`   ❌ Failed for "${cluster.topicLabel}": ${err.message} — backfilling`)
      if (DRY_RUN) dryRunReport.push({ outcome: 'errored', reason: err.message, cluster })
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

  if (results.length === 0 && updatedInPlace.length === 0 && !DRY_RUN) {
    const msg = 'No clusters passed validation — no articles generated'
    console.error(`❌ ${msg}`)
    await logError(date, msg)
    process.exit(1)
  }

  // A dry run stops here: it has everything it set out to show, and the stages
  // below are exactly the ones that must not run.
  if (DRY_RUN) {
    printDryRunReport(date, processed, (Date.now() - startTime) / 1000)
    console.log('')
    usageReport().forEach(l => console.log('   ' + l))
    return
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

  // Stage 9: Announce the edition on X. Runs after the deploy hook so the links
  // point at a site that is already rebuilding; the article route renders on
  // demand anyway, so a link is never dead. Never fails the pipeline.
  if (['1', 'true', 'yes'].includes(String(process.env.SKIP_SOCIAL ?? '').toLowerCase())) {
    console.log('\n⏭  SKIP_SOCIAL set — generating the edition without posting it')
  } else {
    console.log('\n🐦 Stage 9 — Posting the edition to X...')
    try {
      await postDailyThread(date)
    } catch (err) {
      console.warn(`   ⚠ X post failed: ${err.message} — continuing`)
    }
  }

  console.log('')
  usageReport().forEach(l => console.log('   ' + l))

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n✅ Pipeline complete in ${totalElapsed}s`)
  console.log(`   ${results.length} new stories published (all cleared the publication gate) from ${processed} candidates reviewed`)
  if (updatedInPlace.length > 0) {
    console.log(`   ${updatedInPlace.length} continuing story/stories refreshed in place rather than republished`)
  }
}

main().catch(err => {
  console.error('\n💥 Unhandled error:', err)
  process.exit(1)
})
