import type { Metadata } from 'next'
import Link from 'next/link'
import { canonical } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Privacy Policy — Neutral News',
  description:
    'How Neutral News handles data, cookies, and third-party advertising, including Google AdSense.',
  alternates: { canonical: canonical('/privacy') },
}

// Shown as "last updated". Bump this whenever the policy text below changes.
const LAST_UPDATED = 'July 23, 2026'

export default function PrivacyPage() {
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

      <h1 className="text-3xl font-semibold text-slate-900 leading-tight mb-3">Privacy Policy</h1>
      <p className="text-sm text-slate-500 mb-10">Last updated: {LAST_UPDATED}</p>

      <div className="space-y-10 text-slate-700 leading-relaxed">
        <section>
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-4 pb-2 border-b border-slate-200">
            The short version
          </h2>
          <p className="text-sm">
            Neutral News does not ask you to create an account, does not run a newsletter, and does
            not collect names, email addresses, or payment details. We do not sell personal
            information. The only meaningful data collection on this site comes from our advertising
            partner, Google, which is described in full below.
          </p>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-4 pb-2 border-b border-slate-200">
            Information we collect
          </h2>
          <p className="text-sm mb-3">
            We do not operate our own accounts, forms, or trackers. Two categories of data are
            nonetheless involved in serving this site:
          </p>
          <ul className="space-y-2.5 text-sm">
            <li className="flex gap-2.5">
              <span className="text-slate-300 flex-shrink-0 mt-0.5">—</span>
              <span>
                <strong className="font-medium text-slate-900">Standard server logs.</strong> Our
                hosting provider, Vercel, records ordinary request information such as IP address,
                browser type, referring page, and time of request. This is used to serve the site
                securely and to diagnose faults. We do not use it to build profiles of readers.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="text-slate-300 flex-shrink-0 mt-0.5">—</span>
              <span>
                <strong className="font-medium text-slate-900">Advertising data.</strong> Google and
                its partners may set cookies or read device identifiers in order to serve and measure
                ads, as described in the next section.
              </span>
            </li>
          </ul>
          <p className="text-sm mt-3">
            If you email us, we hold your message and address only for as long as it takes to reply.
          </p>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-4 pb-2 border-b border-slate-200">
            Cookies and third-party advertising
          </h2>
          <div className="space-y-3 text-sm">
            <p>
              This site is supported by advertising served through Google AdSense. Third-party
              vendors, including Google, use cookies to serve ads based on your prior visits to this
              website or other websites.
            </p>
            <p>
              Google&apos;s use of advertising cookies enables it and its partners to serve ads to you
              based on your visit to this and other sites on the internet. You may opt out of
              personalised advertising by visiting{' '}
              <a
                href="https://www.google.com/settings/ads"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
              >
                Google Ads Settings
              </a>
              .
            </p>
            <p>
              You can review how Google uses information from sites that use its services at{' '}
              <a
                href="https://policies.google.com/technologies/partner-sites"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
              >
                policies.google.com/technologies/partner-sites
              </a>
              . To opt out of personalised advertising from other vendors, see{' '}
              <a
                href="https://www.aboutads.info/choices/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
              >
                aboutads.info/choices
              </a>
              .
            </p>
            <p>
              Most browsers let you block or delete cookies through their settings. Blocking
              advertising cookies does not prevent you from reading anything on this site.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-4 pb-2 border-b border-slate-200">
            Readers in the EEA, UK, and Switzerland
          </h2>
          <p className="text-sm">
            Where required, Google presents a consent message before setting advertising cookies, and
            your choice is recorded and honoured by Google&apos;s ad systems. Under the GDPR you have
            the right to access, correct, or erase personal data held about you, and to object to
            processing. Because we hold almost no reader data ourselves, most such requests are best
            directed to Google; we will help where we can if you contact us.
          </p>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-4 pb-2 border-b border-slate-200">
            Readers in California
          </h2>
          <p className="text-sm">
            We do not sell or share personal information as those terms are defined by the CCPA/CPRA.
            You may exercise your rights under those laws by contacting us at the address below.
          </p>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-4 pb-2 border-b border-slate-200">
            Children
          </h2>
          <p className="text-sm">
            This site is intended for a general adult audience and is not directed to children under
            13. We do not knowingly collect personal information from children.
          </p>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-4 pb-2 border-b border-slate-200">
            External links
          </h2>
          <p className="text-sm">
            Our articles cite and link to outside news outlets. Those sites have their own privacy
            practices, and we are not responsible for their content or their handling of your data.
          </p>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-4 pb-2 border-b border-slate-200">
            Changes to this policy
          </h2>
          <p className="text-sm">
            If this policy changes, the revised version will be posted on this page with an updated
            date at the top.
          </p>
        </section>

        <section className="border border-slate-200 rounded p-5 bg-slate-50">
          <h2 className="text-xs uppercase tracking-widest text-slate-500 font-semibold mb-3">
            Contact
          </h2>
          <p className="text-sm leading-relaxed">
            Questions about this policy or about data held about you:{' '}
            <a
              href="mailto:piers@spindetector.com"
              className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
            >
              piers@spindetector.com
            </a>
          </p>
        </section>
      </div>
    </div>
  )
}
