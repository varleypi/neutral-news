/**
 * Stage 1 — Select today's top 5 story clusters from SpinDetector's Supabase.
 *
 * Ranks clusters by number of outlets covering the story (breadth of coverage
 * is the best proxy for "this is a real top story").  Returns clusters with
 * all their scored articles so the writer stage has full context.
 */

const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const MAX_STORIES = 5

function getSupabase() {
  const url = process.env.SPINDETECTOR_SUPABASE_URL
  const key = process.env.SPINDETECTOR_SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('SPINDETECTOR_SUPABASE_URL / SPINDETECTOR_SUPABASE_SERVICE_KEY not set')
  return createClient(url, key, { realtime: { transport: ws } })
}

async function selectTopClusters(date) {
  const supabase = getSupabase()

  // Pull all articles for today that belong to a cluster
  const { data: articles, error } = await supabase
    .from('articles')
    .select('cluster_id, topic_label, headline, url, outlet_id, bias_score, pub_date')
    .eq('date', date)
    .not('cluster_id', 'is', null)
    .order('pub_date', { ascending: false })

  if (error) throw new Error(`Supabase query failed: ${error.message}`)
  if (!articles || articles.length === 0) throw new Error(`No clustered articles found for ${date}`)

  // Group by cluster, count unique outlets
  const clusterMap = new Map()
  for (const article of articles) {
    const { cluster_id, topic_label } = article
    if (!clusterMap.has(cluster_id)) {
      clusterMap.set(cluster_id, { clusterId: cluster_id, topicLabel: topic_label, articles: [], outlets: new Set() })
    }
    const c = clusterMap.get(cluster_id)
    c.articles.push({ ...article, published_at: article.pub_date })
    c.outlets.add(article.outlet_id)
  }

  // Rank by unique outlet count, take top 5
  const ranked = [...clusterMap.values()]
    .map(c => ({ ...c, outletCount: c.outlets.size }))
    .sort((a, b) => b.outletCount - a.outletCount)
    .slice(0, MAX_STORIES)

  console.log(`   Selected ${ranked.length} clusters:`)
  ranked.forEach((c, i) =>
    console.log(`   ${i + 1}. [${c.outletCount} outlets] ${c.topicLabel}`)
  )

  return ranked
}

module.exports = { selectTopClusters }
