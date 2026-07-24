/**
 * One-off backfill — consolidate already-published duplicate articles.
 *
 * Before the pipeline gained cross-day memory (see ./history.js), a story that
 * stayed top-ranked was rewritten as a new article on a new URL every day it led
 * the coverage. Those near-identical pages are still live and are exactly what a
 * "low value / thin content" review flags.
 *
 * This script finds each group of articles covering the same event, keeps the
 * EARLIEST as canonical, and sets `canonical_article_id` on the later copies.
 * Nothing is deleted: the later pages stay readable but declare the original as
 * the authoritative URL, and they drop out of the sitemap and archive listings.
 *
 * Usage:
 *   node pipeline/backfill-canonicals.js            # dry run — prints the plan
 *   node pipeline/backfill-canonicals.js --apply    # writes the changes
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })

const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')
const { describesSameEvent } = require('./history')

// How far after the CANONICAL article a duplicate may appear.
//
// Deliberately tighter than the pipeline's 7-day lookback, and measured from the
// canonical rather than from the previous group member. Chaining each candidate
// off the latest member lets a group drift without limit: a first dry run
// against live data linked 07-03 to 07-04 to 07-05 and so on until a World Cup
// group stage result was canonical for the final, eighteen days later.
//
// A story rewritten within three days of the original is a genuine duplicate.
// The same cluster two weeks later is a new development in a running story, and
// marking it duplicate would hide real coverage.
const WINDOW_DAYS = 3

// Headlines that report something not yet settled — either unconfirmed, or
// anticipating an event that had not happened yet. Earliest-first is the right
// default for picking a canonical, but not for these: whatever came later
// carries the confirmed facts and is the version worth making authoritative.
//
// Both patterns come from real errors in a live dry run. Without the first,
// "Reports of Senator Lindsey Graham's Death Cannot Be Verified" outranked the
// confirmed obituary. Without the second, "Spain and Argentina Anticipated to
// Meet in 2026 World Cup Final" outranked the report of the final itself.
const PRELIMINARY = new RegExp(
  [
    // unconfirmed
    'cannot be verified', 'unverified', 'unconfirmed', 'reportedly',
    'rumou?rs?', 'denies reports', 'no confirmation', 'conflicting reports',
    // anticipatory
    'anticipated to', 'expected to', 'prepares? for', 'preparing for',
    'braces? for', 'poised to', 'ahead of', 'looks? toward', 'previews?',
  ].join('|'),
  'i'
)

const APPLY = process.argv.includes('--apply')

// Similarity required to call two articles the same story. Higher is more
// conservative: fewer pages consolidated, but less risk of burying a genuinely
// distinct article under an unrelated canonical.
const thresholdArg = process.argv.find(a => a.startsWith('--threshold='))
const THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : 0.5

if (!Number.isFinite(THRESHOLD) || THRESHOLD <= 0 || THRESHOLD > 1) {
  console.error(`Invalid --threshold: must be a number between 0 and 1`)
  process.exit(1)
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

function daysBetween(a, b) {
  const ms = new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)
  return Math.abs(ms) / 86_400_000
}

async function main() {
  console.log('\n🔗 BACKFILL CANONICAL URLS FOR DUPLICATE ARTICLES')
  console.log('═'.repeat(52))
  console.log(APPLY ? '⚠  APPLY mode — changes will be written' : 'ℹ  Dry run — no changes will be written (pass --apply to write)')
  console.log(`   similarity threshold ${THRESHOLD}, window ${WINDOW_DAYS} days from canonical\n`)

  const supabase = getSupabase()

  const { data: articles, error } = await supabase
    .from('neutral_articles')
    .select('id, date, cluster_id, topic_label, headline, summary, canonical_article_id')
    .eq('validation_approved', true)
    .order('date', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`Failed to load articles: ${error.message}`)
  console.log(`Loaded ${articles.length} approved articles\n`)

  // Walk oldest → newest. The first article of a group becomes its canonical and
  // every later match is compared against THAT article, never against the
  // group's most recent member — anchoring to the canonical is what stops a
  // group drifting across weeks into unrelated territory.
  const groups = [] // { canonical, duplicates: [] }

  for (const article of articles) {
    const text = `${article.headline} ${article.topic_label}`

    let matchedGroup = null
    for (const group of groups) {
      const head = group.canonical
      if (daysBetween(head.date, article.date) > WINDOW_DAYS) continue

      // Same cluster is necessary but not sufficient: a tournament or a war is
      // one cluster spanning many genuinely distinct events, so the text still
      // has to agree.
      const sameCluster = article.cluster_id === head.cluster_id
      const opts = { strict: true, threshold: THRESHOLD }
      const byTopic = describesSameEvent(article.topic_label, head.topic_label, opts)
      const byHeadline = describesSameEvent(text, `${head.headline} ${head.topic_label}`, opts)
      const match = byTopic.same ? byTopic : byHeadline.same ? byHeadline : null

      if (match) {
        matchedGroup = {
          group,
          reason: sameCluster ? `cluster id + similarity ${match.score.toFixed(2)}` : `similarity ${match.score.toFixed(2)}`,
        }
        break
      }
    }

    if (matchedGroup) {
      matchedGroup.group.duplicates.push({ ...article, reason: matchedGroup.reason })
    } else {
      groups.push({ canonical: article, duplicates: [] })
    }
  }

  // Earliest-first is usually right, but not when the earliest article only
  // anticipated the event or reported it unconfirmed. Promote the first settled
  // member so the authoritative URL is the one carrying the confirmed facts.
  let promotions = 0
  for (const group of groups) {
    if (group.duplicates.length === 0) continue
    if (!PRELIMINARY.test(group.canonical.headline)) continue

    const replacement = group.duplicates.find(d => !PRELIMINARY.test(d.headline))
    if (!replacement) continue

    console.log(
      `  ↻ Promoting [${replacement.id}] over [${group.canonical.id}] — ` +
      `the earlier headline is preliminary ("${group.canonical.headline}")`
    )
    group.duplicates = [
      { ...group.canonical, reason: 'preliminary account, superseded' },
      ...group.duplicates.filter(d => d.id !== replacement.id),
    ]
    group.canonical = replacement
    promotions++
  }
  if (promotions > 0) console.log()

  const dupGroups = groups.filter(g => g.duplicates.length > 0)
  const totalDuplicates = dupGroups.reduce((n, g) => n + g.duplicates.length, 0)

  if (dupGroups.length === 0) {
    console.log('✅ No duplicate groups found — nothing to do')
    return
  }

  console.log(`Found ${dupGroups.length} story/stories covered more than once, ${totalDuplicates} duplicate page(s):\n`)
  for (const g of dupGroups) {
    console.log(`  ● canonical  [${g.canonical.id}] ${g.canonical.date}  "${g.canonical.headline}"`)
    for (const d of g.duplicates) {
      const already = d.canonical_article_id === g.canonical.id ? '  (already set)' : ''
      console.log(`      ↳ dup    [${d.id}] ${d.date}  "${d.headline}"  — matched on ${d.reason}${already}`)
    }
    console.log()
  }

  const toUpdate = dupGroups.flatMap(g =>
    g.duplicates
      .filter(d => d.canonical_article_id !== g.canonical.id)
      .map(d => ({ id: d.id, canonical_article_id: g.canonical.id }))
  )

  console.log(`${toUpdate.length} article(s) need updating.`)
  console.log(
    `Consolidating leaves ${articles.length - totalDuplicates} canonical article(s) ` +
    `out of ${articles.length} published.\n`
  )

  if (!APPLY) {
    console.log('Dry run complete — re-run with --apply to write these changes.')
    return
  }

  let updated = 0
  for (const row of toUpdate) {
    const { error: updateError } = await supabase
      .from('neutral_articles')
      .update({ canonical_article_id: row.canonical_article_id })
      .eq('id', row.id)

    if (updateError) console.warn(`   ⚠ Failed to update ${row.id}: ${updateError.message}`)
    else updated++
  }

  console.log(`✅ Updated ${updated} of ${toUpdate.length} article(s)`)
}

main().catch(err => {
  console.error('\n💥 Backfill failed:', err.message)
  process.exit(1)
})
