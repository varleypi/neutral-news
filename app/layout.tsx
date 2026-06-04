import type { Metadata } from 'next'
import { Inter, Lora } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const lora = Lora({ subsets: ['latin'], variable: '--font-lora' })

export const metadata: Metadata = {
  title: 'Neutral News — Factual. Verified. Unbiased.',
  description:
    "Five of today's top stories, written by AI to the highest standards of factual accuracy and political neutrality. Independently reviewed by Claude and Grok.",
  openGraph: {
    title: 'Neutral News',
    description: 'Five top stories. Zero spin.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <body className="bg-white text-slate-900 antialiased">
        <header className="border-b border-slate-200">
          <div className="max-w-3xl mx-auto px-4 py-5 flex items-center justify-between">
            <div>
              <a href="/" className="block">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-slate-400" />
                  <span className="text-sm font-semibold uppercase tracking-widest text-slate-700">
                    Neutral News
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 pl-4">
                  Factual · Verified · Unbiased
                </p>
              </a>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
              <div className="text-xs text-slate-300 mt-0.5">Five stories · Zero spin</div>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-8">{children}</main>

        <footer className="border-t border-slate-100 mt-16">
          <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="text-xs text-slate-400 space-y-1">
              <p>
                Stories sourced via{' '}
                <a
                  href="https://spindetector.com"
                  className="underline hover:text-slate-600 transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  SpinDetector.com
                </a>{' '}
                cluster analysis
              </p>
              <p>Drafted by Claude (Anthropic) · Reviewed by Grok (xAI) · Validated by Claude</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Pipeline runs daily at 08:00 EST
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
