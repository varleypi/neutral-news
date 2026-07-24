import type { Metadata } from 'next'
import Link from 'next/link'
import { getArchiveDays } from '@/lib/supabase'
import { canonical } from '@/lib/site'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Archive — Neutral News',
  description:
    'Every edition of Neutral News, by date. Five neutrally written, independently fact-checked top stories for each publishing day.',
  alternates: { canonical: canonical('/archive') },
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function monthLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  })
}

export default async function ArchivePage() {
  const days = await getArchiveDays()

  // Group editions under a month heading so a long archive stays scannable.
  const months: { label: string; days: typeof days }[] = []
  for (const day of days) {
    const label = monthLabel(day.date)
    const current = months[months.length - 1]
    if (current && current.label === label) current.days.push(day)
    else months.push({ label, days: [day] })
  }

  const totalArticles = days.reduce((sum, d) => sum + d.count, 0)

  return (
    <div>
      <div className="mb-8 border-b border-slate-200 pb-3">
        <h1 className="font-serif text-2xl text-slate-900">Archive</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Every edition we have published — {totalArticles.toLocaleString()}{' '}
          {totalArticles === 1 ? 'story' : 'stories'} across {days.length.toLocaleString()}{' '}
          {days.length === 1 ? 'day' : 'days'}. Each was written from the day&apos;s source coverage,
          independently fact-checked, and validated before publication.
        </p>
      </div>

      {days.length === 0 ? (
        <p className="py-20 text-center text-sm text-slate-400">The archive is not available right now.</p>
      ) : (
        months.map(month => (
          <section key={month.label} className="mb-10">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold mb-4 pb-2 border-b border-slate-100">
              {month.label}
            </h2>
            <ul className="space-y-5">
              {month.days.map(day => (
                <li key={day.date}>
                  <Link
                    href={`/archive/${day.date}`}
                    className="group block"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-serif text-lg text-slate-900 group-hover:text-slate-600 transition-colors">
                        {formatDate(day.date)}
                      </span>
                      <span className="flex-shrink-0 text-xs text-slate-400">
                        {day.count} {day.count === 1 ? 'story' : 'stories'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                      {day.headlines.join(' · ')}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
