import { createClient } from '@supabase/supabase-js'
import { NeutralArticle } from './types'
import { MOCK_ARTICLES } from './mockData'

const isDemoMode =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url'

function getClient() {
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

  if (error) throw new Error(`Failed to fetch articles: ${error.message}`)
  return (data ?? []) as NeutralArticle[]
}

export async function getArticle(id: number): Promise<NeutralArticle | null> {
  if (isDemoMode) return MOCK_ARTICLES.find(a => a.id === id) ?? null

  const supabase = getClient()
  const { data, error } = await supabase
    .from('neutral_articles')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data as NeutralArticle
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
