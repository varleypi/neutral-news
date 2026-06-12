'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

interface Props {
  /** AdSense ad unit slot id, e.g. "1234567890" */
  slot: string
  format?: 'auto' | 'horizontal' | 'rectangle'
  className?: string
}

const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT

/**
 * Renders a Google AdSense unit. Renders nothing until
 * NEXT_PUBLIC_ADSENSE_CLIENT (ca-pub-XXXXXXXXXXXXXXXX) is configured,
 * so the site works identically with ads disabled.
 */
export default function AdSlot({ slot, format = 'auto', className = '' }: Props) {
  useEffect(() => {
    if (!ADSENSE_CLIENT) return
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch {
      // AdSense not loaded (blocked or offline) — fail silently
    }
  }, [])

  if (!ADSENSE_CLIENT) return null

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
