'use client'

import Link from 'next/link'
import { sendGAEvent } from '@next/third-parties/google'
import { analyticsEnabled } from '@/lib/analytics'

interface Props {
  href: string
  /** Numeric article id — the stable key, since headlines get re-worded. */
  articleId: number
  headline: string
  /** 1-based position in the list, so we can see whether rank drives clicks. */
  rank: number
  /** One of the LIST_* constants in `lib/analytics`. */
  listName: string
  className?: string
  children: React.ReactNode
}

/**
 * A headline link that reports which story a reader picked.
 *
 * Page views already tell us how many people reached an article; what they
 * don't tell us is which of the five headlines on the front page earned the
 * click, and from what position. That's the one number worth knowing for a site
 * that publishes a fixed five stories a day, so it's the one custom event here.
 *
 * `select_item` is a GA4 recommended event, which matters: `item_name`,
 * `item_list_name` and `index` are dimensions GA4 reports on out of the box,
 * whereas a bespoke event's parameters stay invisible until someone registers
 * each one as a custom dimension by hand.
 *
 * Deliberately no `item_category`: the obvious candidate, `topic_label`, is a
 * one-off description of that day's story cluster rather than a reusable
 * section name, so it would give GA4 a distinct "category" per article —
 * nothing to group by, and a duplicate of `item_name`.
 *
 * This is the only client component in the article list — `ArticleCard` and
 * `ValidationBadge` stay on the server — so the boundary covers a single <a>.
 */
export default function ArticleLink({
  href,
  articleId,
  headline,
  rank,
  listName,
  className,
  children,
}: Props) {
  function handleClick() {
    // sendGAEvent warns to the console when gtag.js was never loaded, which is
    // every local dev click. Skip it rather than fill the console with noise.
    if (!analyticsEnabled) return

    sendGAEvent('event', 'select_item', {
      item_list_name: listName,
      items: [
        {
          item_id: String(articleId),
          item_name: headline,
          index: rank,
        },
      ],
    })
  }

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  )
}
