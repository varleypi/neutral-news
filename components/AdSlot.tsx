'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

interface Props {
  /** AdSense ad unit slot id — a numeric string, e.g. "1234567890" */
  slot: string
  format?: 'auto' | 'horizontal' | 'rectangle'
  className?: string
}

const ADSENSE_CLIENT =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT || 'ca-pub-9164130388115843'

// A real AdSense ad unit slot is all digits. Placeholder names like
// "home-infeed" are not real units yet, so we don't render a (broken) unit for
// them — the loaded AdSense script / Auto Ads still serve ads on the page.
const isRealSlot = (slot: string) => /^\d+$/.test(slot)

/**
 * Renders a Google AdSense ad unit — but only once a real numeric slot id is
 * supplied. Until then it renders nothing, so the page stays clean while the
 * account is being approved and before ad units are created.
 */
export default function AdSlot({ slot, format = 'auto', className = '' }: Props) {
  const active = Boolean(ADSENSE_CLIENT) && isRealSlot(slot)

  useEffect(() => {
    if (!active) return
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch {
      // AdSense not loaded (blocked or offline) — fail silently
    }
  }, [active])

  if (!active) return null

  return (
    <div className={`my-8 ${className}`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-300 text-center mb-1">
        Advertisement
      </div>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  )
}
