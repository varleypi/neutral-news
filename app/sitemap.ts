import type { MetadataRoute } from 'next'
import { getAllArticleRefs, getArchiveDays } from '@/lib/supabase'
import { canonical } from '@/lib/site'

// Rebuild hourly alongside the rest of the site so new editions appear promptly.
export const revalidate = 3600

/**
 * Served at /sitemap.xml.
 *
 * Every published article gets an entry. Without this, only the five stories
 * linked from the homepage were discoverable — every earlier article was live
 * but orphaned, so crawlers saw a handful of pages and judged the site thin.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, days] = await Promise.all([getAllArticleRefs(), getArchiveDays()])

  const staticPages: MetadataRoute.Sitemap = [
    { url: canonical('/'), changeFrequency: 'daily', priority: 1 },
    { url: canonical('/archive'), changeFrequency: 'daily', priority: 0.8 },
    { url: canonical('/about'), changeFrequency: 'monthly', priority: 0.5 },
    { url: canonical('/privacy'), changeFrequency: 'yearly', priority: 0.3 },
  ]

  const archivePages: MetadataRoute.Sitemap = days.map(day => ({
    url: canonical(`/archive/${day.date}`),
    lastModified: new Date(`${day.date}T12:00:00Z`),
    changeFrequency: 'monthly',
    priority: 0.6,
  }))

  const articlePages: MetadataRoute.Sitemap = articles.map(a => ({
    url: canonical(`/article/${a.id}`),
    lastModified: new Date(a.last_updated_at || a.published_at || `${a.date}T12:00:00Z`),
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  return [...staticPages, ...archivePages, ...articlePages]
}
