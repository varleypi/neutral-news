import type { Metadata } from 'next'
import Script from 'next/script'
import Link from 'next/link'
import { Inter, Lora } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const lora = Lora({ subsets: ['latin'], variable: '--font-lora' })

// Google AdSense publisher ID. Public (appears in the page source of every
// AdSense site), so it's safe to keep in the repo. An env var overrides it.
const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT || 'ca-pub-9164130388115843'

export const metadata: Metadata = {
  metadataBase: new URL('https://neutralnews.us'),
  title: 'Neutral News — Factual. Verified. Unbiased.',
  description:
    "Five of today's top stories, written to the highest standards of factual accuracy and political neutrality. Independently reviewed by Claude and Grok.",
  openGraph: {
    title: 'Neutral News',
    description: 'Five top stories. Zero spin.',
    type: 'website',
    url: 'https://neutralnews.us',
  },
  // AdSense site-verification tag
  other: {
    'google-adsense-account': ADSENSE_CLIENT,
  },
}

function Masthead() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <header>
      {/* Top hairline bar */}
      <div className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between text-[11px] tracking-wide text-slate-400">
          <span>{today}</span>
          <span className="hidden sm:inline">Five stories daily · Verified by two independent AI reviewers</span>
        </div>
      </div>

      {/* Nameplate */}
      <div className="border-b-2 border-slate-900">
        <div className="max-w-3xl mx-auto px-4 py-6 text-center">
          <Link href="/" className="inline-block group">
            <h1 className="font-serif text-4xl sm:text-5xl font-medium tracking-tight text-slate-900">
              Neutral News
            </h1>
          </Link>
          <p className="mt-2 text-[11px] uppercase tracking-[0.25em] text-slate-500">
            Factual &nbsp;·&nbsp; Verified &nbsp;·&nbsp; Unbiased
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="border-b border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 flex items-center justify-center gap-8 text-xs uppercase tracking-widest">
          <Link href="/" className="py-3 text-slate-600 hover:text-slate-900 transition-colors">
            Today
          </Link>
          <Link href="/about" className="py-3 text-slate-600 hover:text-slate-900 transition-colors">
            About &amp; Methodology
          </Link>
          <a
            href="https://spindetector.com"
            target="_blank"
            rel="noopener noreferrer"
            className="py-3 text-slate-600 hover:text-slate-900 transition-colors"
          >
            SpinDetector
          </a>
        </div>
      </nav>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 mt-20 bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="grid sm:grid-cols-3 gap-8 text-sm">
          <div>
            <h3 className="font-serif text-lg text-slate-900 mb-2">Neutral News</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              The day&apos;s most-reported stories, rewritten from verifiable facts and validated by
              two independent AI reviewers before publication.
            </p>
          </div>
          <div>
            <h4 className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold mb-3">
              Site
            </h4>
            <ul className="space-y-2 text-xs text-slate-500">
              <li>
                <Link href="/" className="hover:text-slate-800 transition-colors">Today&apos;s stories</Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-slate-800 transition-colors">About &amp; methodology</Link>
              </li>
              <li>
                <a
                  href="https://spindetector.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-slate-800 transition-colors"
                >
                  SpinDetector.com
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold mb-3">
              Contact
            </h4>
            <ul className="space-y-2 text-xs text-slate-500">
              <li>
                <a
                  href="mailto:piers@spindetector.com"
                  className="hover:text-slate-800 transition-colors"
                >
                  piers@spindetector.com
                </a>
              </li>
              <li className="text-slate-400">Questions, feedback &amp; press</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            Drafted by Claude (Anthropic) · Fact-checked by Grok (xAI) · Validated before publication
          </p>
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            New edition daily, 08:00 EST
          </p>
        </div>
      </div>
    </footer>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <body className="bg-white text-slate-900 antialiased">
        {ADSENSE_CLIENT && (
          <Script
            id="adsense"
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
        <Masthead />
        <main className="max-w-3xl mx-auto px-4 py-10">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
