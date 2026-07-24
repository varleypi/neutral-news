import { createClient } from '@supabase/supabase-js'
import { NeutralArticle } from './types'
import { MOCK_ARTICLES } from './mockData'

const isDemoMode =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url'

function getClient() {
  // Frontend uses the anon (public) key only — never the service role key.
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function getTodaysArticles(date?: string): Promise<NeutralArticle[]> {
  if (isDemoMode) return MOCK_ARTICLES

  const targetDate = date ?? new Date().toISOString().split('T')[0]
  const supabase = getClient()

  const { data, error } = await supabase
    .from('neutral_articles')
    .select('*')
    .eq('date', targetDate)
    .eq('validation_approved', true)
    .order('outlet_count', { ascending: false })
    .limit(5)

  if (error) {
    // Fail soft: an empty page beats a crashed build/deploy
    console.error(`Failed to fetch articles: ${error.message}`)
    return []
  }
  return (data ?? []) as NeutralArticle[]
}

export async function getArticle(id: number): Promise<NeutralArticle | null> {
  // Reject anything that isn't a plausible row id before it reaches the database
  if (!Number.isInteger(id) || id < 1 || id > Number.MAX_SAFE_INTEGER) return null

  if (isDemoMode) return MOCK_ARTICLES.find(a => a.id === id) ?? null

  const supabase = getClient()
  const { data, error } = await supabase
    .from('neutral_articles')
    .select('*')
    .eq('id', id)
    .eq('validation_approved', true)
    .single()

  if (error) return null
  return data as NeutralArticle
}

export async function getRecentArticles(limit = 20): Promise<NeutralArticle[]> {
  if (isDemoMode) return MOCK_ARTICLES

  const supabase = getClient()
  const { data, error } = await supabase
    .from('neutral_articles')
    .select('*')
    .eq('validation_approved', true)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error(`Failed to fetch recent articles: ${error.message}`)
    return []
  }
  return (data ?? []) as NeutralArticle[]
}

/** Every approved article for one edition date, ranked as the homepage ranks them. */
export async function getArticlesByDate(date: string): Promise<NeutralArticle[]> {
  if (isDemoMode) return MOCK_ARTICLES

  const supabase = getClient()
  const { data, error } = await supabase
    .from('neutral_articles')
    .select('*')
    .eq('date', date)
    .eq('validation_approved', true)
    .order('outlet_count', { ascending: false })

  if (error) {
    console.error(`Failed to fetch articles for ${date}: ${error.message}`)
    return []
  }
  return (data ?? []) as NeutralArticle[]
}

export interface ArchiveDay {
  date: string
  count: number
  headlines: string[]
}

/**
 * Every edition date that has published articles, newest first.
 *
 * Supabase has no DISTINCT/GROUP BY over the REST API, so we pull the light
 * columns for all approved rows and group in memory. At five articles a day
 * this stays in the low thousands of rows for years.
 */
export async function getArchiveDays(): Promise<ArchiveDay[]> {
  if (isDemoMode) {
    return [{ date: '2026-06-03', count: MOCK_ARTICLES.length, headlines: MOCK_ARTICLES.map(a => a.headline) }]
  }

  const supabase = getClient()
  const { data, error } = await supabase
    .from('neutral_articles')
    .select('date, headline, outlet_count')
    .eq('validation_approved', true)
    .order('date', { ascending: false })
    .order('outlet_count', { ascending: false })
    .limit(5000)

  if (error) {
    console.error(`Failed to fetch archive days: ${error.message}`)
    return []
  }

  const byDate = new Map<string, string[]>()
  for (const row of (data ?? []) as { date: string; headline: string }[]) {
    const list = byDate.get(row.date)
    if (list) list.push(row.headline)
    else byDate.set(row.date, [row.headline])
  }

  return [...byDate.entries()].map(([date, headlines]) => ({
    date,
    count: headlines.length,
    headlines,
  }))
}

/**
 * Minimal article rows for the sitemap — id and dates only, no bodies.
 *
 * Articles flagged as duplicates of an earlier story are excluded: they declare
 * the original as their canonical URL, so listing them here would ask crawlers
 * to index pages we have already told them not to treat as authoritative.
 */
export async function getAllArticleRefs(): Promise<
  { id: number; date: string; published_at: string; last_updated_at?: string | null }[]
> {
  if (isDemoMode) {
    return MOCK_ARTICLES.map(a => ({ id: a.id, date: a.date, published_at: a.published_at }))
  }

  const supabase = getClient()
  const { data, error } = await supabase
    .from('neutral_articles')
    .select('id, date, published_at, last_updated_at')
    .eq('validation_approved', true)
    .is('canonical_article_id', null)
    .order('published_at', { ascending: false })
    .limit(5000)

  if (error) {
    console.error(`Failed to fetch article refs: ${error.message}`)
    return []
  }
  return (data ?? []) as { id: number; date: string; published_at: string; last_updated_at?: string | null }[]
}

export async function getLatestDate(): Promise<string> {
  if (isDemoMode) return '2026-06-03'

  const supabase = getClient()
  const { data } = await supabase
    .from('neutral_articles')
    .select('date')
    .eq('validation_approved', true)
    .order('date', { ascending: false })
    .limit(1)
    .single()

  return data?.date ?? new Date().toISOString().split('T')[0]
}

export { isDemoMode }
