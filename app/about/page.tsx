import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About & Methodology — Neutral News',
  description:
    'How Neutral News selects, writes, fact-checks, and validates five neutral news stories every day using a dual-AI editorial pipeline.',
}

const PIPELINE_STEPS = [
  {
    step: '1',
    title: 'Story selection',
    body: 'Every morning, we analyse the story clusters identified by SpinDetector.com — which tracks how dozens of major news outlets across the political spectrum cover the same events. The five stories covered by the largest number of independent outlets become the day’s top stories. Breadth of coverage, not editorial taste, decides what is news.',
  },
  {
    step: '2',
    title: 'Neutral drafting',
    body: 'Claude (Anthropic) writes each article to wire-service standards: inverted-pyramid structure, every claim attributed to a named source, no loaded verbs, no judgment-carrying adjectives, no speculation about motives. Where sources conflict, the conflict is reported neutrally rather than resolved.',
  },
  {
    step: '3',
    title: 'Independent fact-check',
    body: 'Grok (xAI) — a separate model from a separate company — audits the draft against the source coverage. It flags any claim that cannot be verified, any loaded or biased language, any missing perspective, and any opinion presented as fact, producing a structured critique with severity ratings.',
  },
  {
    step: '4',
    title: 'Revision',
    body: 'Claude revises the article to address every issue raised in Grok’s critique. Required corrections are always applied; the goal is an article both models agree is accurate and neutral.',
  },
  {
    step: '5',
    title: 'Final validation',
    body: 'A final editorial validation pass certifies the article: it is checked for factual neutrality, fair representation of all sides, an accurate non-sensational headline, and confirmation that earlier review issues were resolved. The article receives a neutrality rating and confidence score — both published alongside the story. Articles that fail validation are not published.',
  },
]

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-8"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Today&apos;s news
      </Link>

      <h1 className="text-3xl font-semibold text-slate-900 leading-tight mb-3">
        About Neutral News
      </h1>
      <p className="text-lg text-slate-600 leading-relaxed mb-10">
        Five top stories a day. Written from facts, not framing. Every article is drafted,
        independently fact-checked, and validated by two different AI systems before it is published.
      </p>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-6 pb-2 border-b border-slate-200">
          Why we exist
        </h2>
        <div className="space-y-4 text-slate-700 leading-relaxed">
          <p>
            The same news event is routinely reported in incompatible ways. Word choice, emphasis,
            sourcing, and framing push readers toward conclusions before they have seen the facts.
            Our sister site,{' '}
            <a
              href="https://spindetector.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
            >
              SpinDetector.com
            </a>
            , measures that bias every day across major outlets.
          </p>
          <p>
            Neutral News is the answer to the question that measurement raises: <em>what would the
            story look like with the spin removed?</em> We publish only what is verifiable, attribute
            every claim, and report disagreement as disagreement — leaving interpretation where it
            belongs, with the reader.
          </p>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-6 pb-2 border-b border-slate-200">
          Methodology
        </h2>
        <ol className="space-y-6">
          {PIPELINE_STEPS.map(({ step, title, body }) => (
            <li key={step} className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center">
                <span className="text-sm font-medium text-slate-500">{step}</span>
              </div>
              <div className="pt-0.5">
                <h3 className="font-semibold text-slate-900 mb-1">{title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-6 pb-2 border-b border-slate-200">
          Editorial standards
        </h2>
        <ul className="space-y-2.5 text-sm text-slate-700">
          {[
            'Every factual claim is attributed to a named source — "according to", "said", "stated".',
            'Neutral verbs only: people "say" things; they do not "claim", "insist", "admit", or "slam".',
            'No judgment-carrying adjectives. No story is "controversial", "radical", or "historic" by our telling.',
            'Conflicting accounts are reported side by side, not adjudicated.',
            'Who did what is always stated directly — no passive voice that hides agency.',
            'A maximum of five stories per day. Volume is not the goal; reliability is.',
          ].map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="text-slate-300 flex-shrink-0 mt-0.5">—</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-6 pb-2 border-b border-slate-200">
          Honest limitations
        </h2>
        <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
          <p>
            Our articles are written from the day&apos;s source coverage — we do not have reporters in
            the field, and we can only be as accurate as the underlying reporting. AI review
            substantially reduces bias and error, but no process, human or machine, is perfect.
            The validation scores published with each article reflect genuine model confidence,
            not a guarantee.
          </p>
          <p>
            If you believe an article contains an error, we want to know.
          </p>
        </div>
      </section>

      <section className="border border-slate-200 rounded p-5 bg-slate-50">
        <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-3">
          Contact
        </h2>
        <p className="text-sm text-slate-700 leading-relaxed">
          Questions, feedback, corrections, or press inquiries:{' '}
          <a
            href="mailto:piers@spindetector.com"
            className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
          >
            piers@spindetector.com
          </a>
        </p>
      </section>
    </div>
  )
}
