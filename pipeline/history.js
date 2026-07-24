/**
 * Recently-published history — gives the pipeline memory across days.
 *
 * Without this, `selectTopClusters` ranks each day's clusters in isolation, so a
 * story that stays the most widely covered for a week (a war, a tournament
 * final, a leadership change) is rewritten as a new article on a new URL every
 * single day. The result is sets of near-identical pages that read as duplicate,
 * low-value content.
 *
 * With it, a candidate that has already been covered recently is either skipped
 * (nothing new has happened) or used to refresh the ORIGINAL article in place,
 * so each real-world story keeps one durable URL.
 */

const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

// How far back to look for an earlier article covering the same story.
const LOOKBACK_DAYS = 7

// Similarity at or above this means the new draft says nothing materially new
// versus what we already published, so there is nothing worth republishing.
const NO_NEW_INFORMATION = 0.6

// Similarity at or above this between a candidate and a published story means
// they are about the same event, even if the cluster ids differ.
const SAME_EVENT = 0.5

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'after',
  'amid', 'says', 'said', 'will', 'draw', 'both', 'raise', 'raising', 'questions',
  'new', 'plan', 'plans', 'move', 'moves', 'set', 'sets',
])

function significantWords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w))
}

function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 || B.size === 0) return 0
  const intersection = [...A].filter(x => B.has(x)).length
  const union = new Set([...A, ...B]).size
  return intersection / union
}

function similarity(textA, textB) {
  return jaccard(significantWords(textA), significantWords(textB))
}

// Fraction of the SHORTER text's words that also appear in the longer one.
//
// Jaccard divides by the union, so it scores two topic labels of unequal length
// low even when one fully contains the other's subject: "2026 FIFA World Cup
// begins, semifinals underway" vs "2026 FIFA World Cup final and aftermath"
// share every distinguishing word but score only 0.38, because each side
// carries extra words the other lacks. Overlap ignores that asymmetry.
function overlap(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 || B.size === 0) return 0
  const intersection = [...A].filter(x => B.has(x)).length
  return intersection / Math.min(A.size, B.size)
}

// Overlap alone is too eager on short strings — two words in common out of two
// scores a perfect 1.0 — so a match also has to clear a floor of shared words.
const STRONG_OVERLAP = 0.6
const MIN_SHARED_WORDS = 3

// The overlap path needs a Jaccard floor too. Without one, a topic label that is
// a strict subset of another scores a perfect 1.0 — "2026 FIFA World Cup" inside
// "2026 FIFA World Cup knockout stage" — which is exactly how a multi-week
// tournament or a running war, one cluster but many distinct events, collapses
// into a single story.
const MIN_JACCARD_FOR_OVERLAP = 0.4

/**
 * True if two texts describe the same event, by either measure:
 * a solid Jaccard score, or a high overlap backed by enough shared words and a
 * Jaccard floor.
 *
 * `strict` drops the overlap path entirely. Use it where a false positive is
 * costly and unrecoverable — the backfill marks articles as duplicates with no
 * later check, whereas the pipeline always follows a match with
 * `hasMaterialDevelopment`, which catches over-eager matches before anything is
 * suppressed.
 */
function describesSameEvent(textA, textB, { threshold = SAME_EVENT, strict = false } = {}) {
  const a = significantWords(textA)
  const b = significantWords(textB)
  const shared = [...new Set(a)].filter(w => new Set(b).has(w)).length

  const jaccardScore = jaccard(a, b)
  if (jaccardScore >= threshold) return { same: true, score: jaccardScore }

  if (strict) return { same: false, score: jaccardScore }

  const overlapScore = overlap(a, b)
  if (
    overlapScore >= STRONG_OVERLAP &&
    shared >= MIN_SHARED_WORDS &&
    jaccardScore >= MIN_JACCARD_FOR_OVERLAP
  ) {
    return { same: true, score: overlapScore }
  }
  return { same: false, score: Math.max(jaccardScore, overlapScore) }
}

function getSupabase() {
  const url = process.env.NEUTRAL_NEWS_SUPABASE_URL || process.env.SPINDETECTOR_SUPABASE_URL
  const key = process.env.NEUTRAL_NEWS_SUPABASE_SERVICE_KEY || process.env.SPINDETECTOR_SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase credentials not set')
  return createClient(url, key, {
    realtime: { transport: ws },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function daysBefore(date, days) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().split('T')[0]
}

/**
 * Articles published in the LOOKBACK_DAYS before `date`, newest first.
 * Excludes rows already marked as duplicates so we always compare against, and
 * update, the canonical copy of a story.
 */
async function getRecentlyPublished(date, lookbackDays = LOOKBACK_DAYS) {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('neutral_articles')
    .select('id, date, cluster_id, topic_label, headline, summary, key_facts, update_count')
    .gte('date', daysBefore(date, lookbackDays))
    .lt('date', date)
    .eq('validation_approved', true)
    .is('canonical_article_id', null)
    .order('date', { ascending: false })

  if (error) {
    // History is an optimisation, not a correctness requirement — a failure here
    // must not take the daily edition down.
    console.warn(`   ⚠ Could not load publishing history: ${error.message}`)
    return []
  }
  return data ?? []
}

/**
 * The most recent earlier article covering the same story as `cluster`, or null.
 *
 * Matches on cluster id first (exact, cheap). Falls back to text similarity,
 * because SpinDetector re-clusters daily and the same running story frequently
 * lands under a fresh cluster id.
 *
 * The fallback compares TOPIC LABEL to TOPIC LABEL as its primary signal. Topic
 * labels are short, canonical descriptions of the event ("US-Iran military
 * strikes over Strait of Hormuz") and stay stable while a story runs, whereas
 * headlines are rewritten around each day's development and can share almost no
 * vocabulary between editions of the same story. Comparing against the headline
 * as well only ever adds matches, so both are tried and the stronger wins.
 */
function findPriorCoverage(cluster, recent) {
  const byCluster = recent.find(a => a.cluster_id === cluster.clusterId)
  if (byCluster) return { prior: byCluster, matchedOn: 'cluster id' }

  let best = null
  for (const article of recent) {
    const byTopic = describesSameEvent(cluster.topicLabel, article.topic_label)
    const byHeadline = describesSameEvent(cluster.topicLabel, `${article.headline} ${article.topic_label}`)
    const match = byTopic.same ? byTopic : byHeadline.same ? byHeadline : null
    if (match && (!best || match.score > best.score)) {
      best = { prior: article, score: match.score, matchedOn: `topic similarity ${match.score.toFixed(2)}` }
    }
  }
  return best ? { prior: best.prior, matchedOn: best.matchedOn } : null
}

/**
 * Given a finished draft for a story we have covered before, decide whether it
 * carries genuinely new information.
 *
 * Compares the parts that actually convey developments — headline, summary and
 * key facts — rather than the whole body, whose wire-style boilerplate is
 * similar between editions regardless of what changed.
 */
function hasMaterialDevelopment(draft, prior) {
  const nextText = [draft.headline, draft.summary, ...(draft.keyFacts ?? [])].join(' ')
  const priorText = [prior.headline, prior.summary, ...(prior.key_facts ?? [])].join(' ')
  const score = similarity(nextText, priorText)
  return { developed: score < NO_NEW_INFORMATION, score }
}

module.exports = {
  getRecentlyPublished,
  findPriorCoverage,
  hasMaterialDevelopment,
  describesSameEvent,
  similarity,
  significantWords,
  jaccard,
  overlap,
  LOOKBACK_DAYS,
}
