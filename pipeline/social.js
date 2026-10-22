/**
 * Stage 9 (optional) — post the day's edition to X (Twitter) as a thread.
 *
 * Shape of the thread:
 *   root    — a hook with NO link in the body. X suppresses reach on posts that
 *             carry an external link, so the post that has to travel carries none.
 *   1..5    — one reply per story: rank, headline, and its /article/{id} URL.
 *             Replies are already downranked relative to the root, so the links
 *             cost far less there than they would up top.
 *
 * Gated on the X_* env vars — if any are missing it logs and skips, never
 * failing the pipeline. Requires an X developer app with Read+Write permission
 * and OAuth 1.0a user tokens belonging to the Neutral News account.
 *
 * Idempotent per edition date via `neutral_social_posts` (see
 * supabase/migrations/003_social_posts.sql): the pipeline runs twice most days
 * (SpinDetector's dispatch, then the backup cron) and must not post twice.
 */

const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const SITE_URL = 'https://www.neutralnews.us'
const MAX_TWEET = 280
const MAX_STORIES = 5

const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']

function getSupabase() {
  const url = process.env.NEUTRAL_NEWS_SUPABASE_URL || process.env.SPINDETECTOR_SUPABASE_URL
  const key = process.env.NEUTRAL_NEWS_SUPABASE_SERVICE_KEY || process.env.SPINDETECTOR_SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase credentials not set')
  return createClient(url, key, {
    realtime: { transport: ws },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function truncate(str, max) {
  const s = String(str ?? '')
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}

// Deterministic 0..(n-1) pick from a string, so a given day always gets the same
// opener but successive days vary — a byte-identical daily post reads as
// automation to X's ranking.
function pick(variants, seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return variants[Math.abs(h) % variants.length]
}

const OPENERS = [
  'Today’s biggest stories, with the spin taken out.',
  'The day’s top stories — reported straight.',
  'What happened today, without the framing.',
  'Today’s headlines, rewritten to remove the slant.',
]

/** Human date for the hook, e.g. "29 July 2026". Built from the ISO date only. */
function prettyDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  if (!y || !m || !d) return ''
  return `${d} ${months[m - 1]} ${y}`
}

/**
 * Build the thread from the day's stored articles.
 * Returns { root, replies } — plain strings, ready to post in order.
 */
function composeThread(articles, date) {
  if (!Array.isArray(articles) || articles.length === 0) return null

  const stories = articles.slice(0, MAX_STORIES)
  const outlets = stories.reduce((n, a) => n + (a.outlet_count || 0), 0)

  const opener = pick(OPENERS, date)
  const when = prettyDate(date)
  const credit = outlets > 0
    ? `${stories.length} stories · ${outlets} outlet reports read · every claim checked by two independent AI models.`
    : `${stories.length} stories · every claim checked by two independent AI models.`
  const root = truncate(`${opener}${when ? ` ${when}.` : ''}\n\n${credit}\n\nThe ${stories.length} 👇`, MAX_TWEET)

  const replies = stories.map((a, i) => {
    const url = `${SITE_URL}/article/${a.id}`
    // Reserve room for the rank prefix, the two newlines, and the URL. X counts
    // every link as 23 characters regardless of its real length.
    const fixed = `${i + 1}. \n\n`.length + 23
    return `${i + 1}. ${truncate(a.headline, Math.max(20, MAX_TWEET - fixed))}\n\n${url}`
  })

  return { root, replies }
}

/** The edition as the homepage ranks it: approved, most-covered first, top 5. */
async function getEdition(supabase, date) {
  const { data, error } = await supabase
    .from('neutral_articles')
    .select('id, headline, outlet_count')
    .eq('date', date)
    .eq('validation_approved', true)
    .order('outlet_count', { ascending: false })
    .limit(MAX_STORIES)

  if (error) throw new Error(`Failed to load the edition: ${error.message}`)
  return data ?? []
}

/**
 * Has today's thread already gone out?
 *
 * Fails open: if the log table is missing we warn and post, because a missing
 * migration should not silently mute the account.
 */
async function alreadyPosted(supabase, date) {
  const { data, error } = await supabase
    .from('neutral_social_posts')
    .select('thread_id')
    .eq('date', date)
    .maybeSingle()

  if (error) {
    console.warn(`   ⚠ Could not check the post log (${error.message}) — posting anyway`)
    return null
  }
  return data
}

async function postDailyThread(date) {
  const missing = X_ENV.filter((k) => !process.env[k])
  if (missing.length > 0) {
    console.log(`   ℹ X posting disabled (missing ${missing.join(', ')})`)
    return
  }

  let supabase
  try {
    supabase = getSupabase()
  } catch (err) {
    console.warn(`   ⚠ X post skipped: ${err.message}`)
    return
  }

  const prior = await alreadyPosted(supabase, date)
  if (prior) {
    console.log(`   ℹ Already posted the ${date} edition (thread ${prior.thread_id ?? 'unknown'}) — skipping`)
    return
  }

  let articles
  try {
    articles = await getEdition(supabase, date)
  } catch (err) {
    console.warn(`   ⚠ X post skipped: ${err.message}`)
    return
  }

  const thread = composeThread(articles, date)
  if (!thread) {
    console.log('   ℹ No new articles for this date — nothing to post')
    return
  }

  let rootId = null
  let sent = 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TwitterApi } = require('twitter-api-v2')
    const client = new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    })

    const res = await client.v2.tweet(thread.root)
    rootId = res?.data?.id
    sent = 1
    console.log(`   ✓ Posted thread root to X (id ${rootId ?? 'unknown'})`)

    // Chain each story off the previous post so it reads as one thread.
    let replyTo = rootId
    for (const [i, text] of thread.replies.entries()) {
      if (!replyTo) break
      try {
        const r = await client.v2.tweet(text, { reply: { in_reply_to_tweet_id: replyTo } })
        replyTo = r?.data?.id ?? replyTo
        sent++
      } catch (err) {
        // A partial thread still beats no thread — stop replying, keep the root.
        console.warn(`   ⚠ Reply ${i + 1} failed: ${err.message} — thread truncated`)
        break
      }
    }
    console.log(`   ✓ Thread posted: ${sent} post(s)`)
  } catch (err) {
    console.warn(`   ⚠ X post failed: ${err.message} — continuing`)
  }

  // Record whatever went out, so a later run for the same date doesn't repeat it.
  if (rootId) {
    const { error } = await supabase
      .from('neutral_social_posts')
      .upsert({ date, thread_id: rootId, post_count: sent, posted_at: new Date().toISOString() },
        { onConflict: 'date' })
    if (error) console.warn(`   ⚠ Failed to log the post (${error.message}) — a rerun today may post again`)
  }
}

module.exports = { postDailyThread, composeThread }
