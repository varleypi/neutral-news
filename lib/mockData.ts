import { NeutralArticle } from './types'

export const MOCK_ARTICLES: NeutralArticle[] = [
  {
    id: 1,
    date: '2026-06-03',
    cluster_id: 'federal-budget-vote',
    topic_label: 'Congress votes on federal budget bill',
    headline: 'Senate Passes Federal Budget Bill 52-48 After Three-Day Debate',
    summary: 'The Senate approved a $1.7 trillion federal budget after three days of floor debate, with the bill now moving to the president for signature.',
    body: `The Senate passed a $1.7 trillion federal budget Tuesday evening, 52 to 48, closing three days of debate over how much the government should spend on defense, social programs, and infrastructure. The bill now moves to the president's desk.

The two parties read the same legislation and described it in opposite terms. Senate leadership called it responsible fiscal policy. The opposition said it deepens the deficit without addressing the spending that drives it.

The central number in that dispute comes from the Congressional Budget Office, the nonpartisan body that scores the cost of legislation. The CBO projects the bill will add $280 billion to the deficit over the next decade. The bill's chief sponsor disputes that figure, arguing it does not account for the economic growth the spending is intended to produce.

The provisions themselves are more specific than the debate around them. Defense spending rises 4 percent. Domestic discretionary spending holds flat once inflation is accounted for. The Department of Transportation receives the largest single increase, an additional $12 billion written into the text.

What happens next rests with the president, who has not said whether he will sign. The White House said only that it is reviewing the final text. Without his signature, the bill would require a two-thirds vote in both chambers to become law.`,
    key_facts: [
      'Senate voted 52-48 to pass the $1.7 trillion budget bill',
      'CBO estimated the bill adds $280 billion to the deficit over ten years',
      'Defense spending increases 4%; domestic discretionary spending stays flat',
    ],
    references: [
      'Reuters — vote count and floor procedure',
      'Associated Press — leadership statements from both parties',
      'Congressional Budget Office — $280 billion deficit projection',
      'Wall Street Journal — defense and discretionary spending breakdown',
      'Politico — White House response and signing timeline',
    ],
    outlet_count: 18,
    sources_used: ['reuters', 'ap', 'nyt', 'wsj', 'politico'],
    grok_review_score: 9.1,
    grok_reviewer: 'grok',
    validation_approved: true,
    validation_confidence: 9.4,
    validation_neutrality: 'Excellent',
    validation_notes: 'Article maintains strict neutrality. All claims attributed. No loaded language detected.',
    validation_reviewed_at: '2026-06-03T07:42:00Z',
    published_at: '2026-06-03T08:00:00Z',
  },
  {
    id: 2,
    date: '2026-06-03',
    cluster_id: 'fed-interest-rates',
    topic_label: 'Federal Reserve holds interest rates steady',
    headline: 'Federal Reserve Holds Benchmark Rate at 4.5%, Cites Mixed Economic Data',
    summary: 'The Federal Reserve left its benchmark interest rate unchanged at 4.5% following its two-day policy meeting, citing conflicting signals on inflation and employment.',
    body: `The Federal Reserve held its benchmark interest rate steady at 4.5% on Wednesday, choosing to wait rather than move as its two-day policy meeting closed. The decision leaves borrowing costs where they have sat for months.

Chair Jerome Powell framed it as a matter of patience. The Fed needs to see more data, he told reporters, before it commits to a direction. The reason for the caution is written into the numbers pulling in opposite directions. Inflation, by the Fed's preferred measure, ran at 2.7% in April — still above the 2% the central bank aims for. Employment, meanwhile, looks healthy: unemployment held at 4.1% in May, comfortably within the range the Fed considers full employment.

That tension showed inside the committee itself. Three members broke with the decision to hold. Two wanted a quarter-point cut, pointing to signs that consumers are pulling back on spending. A third wanted to raise rates, worried that inflation has not yet been tamed. The split is a rare public glimpse of a committee that usually speaks with one voice.

Investors had largely seen it coming — futures markets put the odds of no change at 78%. The reaction was muted but negative: the S&P 500 slipped 0.4% after the announcement.`,
    key_facts: [
      'Fed held benchmark rate at 4.5% following FOMC meeting',
      'PCE inflation was 2.7% in April, above the 2% target',
      'Three members dissented: two for a cut, one for a hike',
    ],
    references: [
      'Federal Reserve — FOMC statement and rate decision',
      'Reuters — Powell press conference remarks',
      'Bureau of Labor Statistics — May unemployment figure',
      'Bloomberg — dissent breakdown among FOMC members',
      'CME Group FedWatch — market-implied probability',
    ],
    outlet_count: 22,
    sources_used: ['reuters', 'ap', 'wsj', 'bloomberg', 'ft'],
    grok_review_score: 9.6,
    grok_reviewer: 'grok',
    validation_approved: true,
    validation_confidence: 9.7,
    validation_neutrality: 'Excellent',
    validation_notes: 'All figures sourced. Dissent accurately represented. Neutral throughout.',
    validation_reviewed_at: '2026-06-03T07:38:00Z',
    published_at: '2026-06-03T08:00:00Z',
  },
  {
    id: 3,
    date: '2026-06-03',
    cluster_id: 'nato-summit-defense',
    topic_label: 'NATO summit concludes with new defense spending pledge',
    headline: 'NATO Members Agree to Raise Defense Spending Floor to 3% of GDP by 2030',
    summary: 'NATO allies unanimously agreed to raise the alliance\'s minimum defense spending target from 2% to 3% of GDP, to be met by all member states by 2030.',
    body: `NATO's 32 members agreed in Brussels on Thursday to raise the floor on defense spending from 2% of national income to 3%, the largest such commitment the alliance has made in decades. They gave themselves until 2030 to get there.

For most members, that deadline marks real work ahead. Nineteen of the 32 currently meet even the existing 2% target, according to the alliance's own annual report. Reaching 3% means sustained increases across most of the continent at a time when many governments are already stretched.

Secretary General Jens Stoltenberg called it the most significant increase in collective defense investment in a generation. Defense ministers arriving at the summit were blunter about why: the security landscape changed when Russia invaded Ukraine in 2022, and the alliance has been recalculating ever since.

There is a gap, though, between the pledge and its force. The agreement carries no legal enforcement. One senior official from a member state, speaking privately because they were not authorized to discuss it publicly, described the commitment as political rather than binding, with the same loose monitoring that applied to the old 2% goal. Members have until the end of 2026 to submit plans for how they intend to meet it.`,
    key_facts: [
      '32 NATO members unanimously agreed to raise spending floor to 3% of GDP',
      '19 of 32 members currently meet the existing 2% target',
      'Deadline set for 2030; commitment is political, not legally binding',
    ],
    references: [
      'NATO communiqué — 3% target and 2030 deadline',
      'NATO 2026 annual report — current members meeting 2% target',
      'Reuters — Secretary General statement',
      'BBC — defense ministers’ remarks on security environment',
      'Financial Times — senior official on non-binding nature',
    ],
    outlet_count: 15,
    sources_used: ['reuters', 'ap', 'bbc', 'guardian', 'ft'],
    grok_review_score: 8.8,
    grok_reviewer: 'grok',
    validation_approved: true,
    validation_confidence: 9.0,
    validation_neutrality: 'Good',
    validation_notes: 'Solid neutrality. Anonymous source properly caveated. Minor suggestion to include a dissenting member state view was not actionable from source material.',
    validation_reviewed_at: '2026-06-03T07:51:00Z',
    published_at: '2026-06-03T08:00:00Z',
  },
  {
    id: 4,
    date: '2026-06-03',
    cluster_id: 'supreme-court-ruling',
    topic_label: 'Supreme Court rules on administrative agency power',
    headline: 'Supreme Court Rules 6-3 to Limit Federal Agencies\' Rulemaking Authority',
    summary: 'The Supreme Court ruled 6-3 that federal agencies must receive explicit congressional authorization before issuing major regulations, expanding the scope of its 2024 Loper Bright decision.',
    body: `The Supreme Court ruled 6 to 3 on Tuesday that federal agencies cannot issue major regulations unless Congress has clearly authorized them to, extending a line of reasoning the Court began in its 2024 Loper Bright decision. The ruling reaches every agency in the executive branch.

Writing for the majority, Chief Justice John Roberts held that when a regulation carries major economic or political significance, the power to issue it cannot simply be read into broad, general language in a statute. Congress has to say so. The Court declined to draw a precise line for what counts as "major," leaving that judgment to future cases.

Justice Sonia Sotomayor, joined by Justices Elena Kagan and Ketanji Brown Jackson, dissented sharply. The decision, she wrote, dismantles decades of regulatory law and hands the judiciary the power to decide which rules an agency may issue on its own — authority that until now belonged to the executive branch.

The case turned on a concrete rule: an Environmental Protection Agency limit on methane leaking from oil and gas operations. That rule is now vacated. The EPA said it would work with Congress and within its existing authority to respond.

The practical effect reaches well beyond methane. Legal scholars say the ruling will force Congress to write far more detailed laws whenever it wants agencies to act on big questions — and that bringing existing regulations into line with the new standard could take years.`,
    key_facts: [
      'Court ruled 6-3 agencies need explicit congressional authorization for major rules',
      'The EPA methane emissions rule was vacated by the decision',
      'Dissent argued ruling transfers authority from executive to judicial branch',
    ],
    references: [
      'SCOTUSblog — full opinion and vote breakdown',
      'Reuters — majority holding authored by Chief Justice Roberts',
      'Associated Press — Sotomayor dissent',
      'Wall Street Journal — vacated EPA methane rule',
      'New York Times — legal scholars on implications',
    ],
    outlet_count: 24,
    sources_used: ['reuters', 'ap', 'scotusblog', 'nyt', 'wsj'],
    grok_review_score: 9.3,
    grok_reviewer: 'grok',
    validation_approved: true,
    validation_confidence: 9.5,
    validation_neutrality: 'Excellent',
    validation_notes: 'Both majority and dissent accurately represented. Legal context properly attributed to scholars. No editorial bias.',
    validation_reviewed_at: '2026-06-03T07:44:00Z',
    published_at: '2026-06-03T08:00:00Z',
  },
  {
    id: 5,
    date: '2026-06-03',
    cluster_id: 'immigration-policy-update',
    topic_label: 'Administration announces changes to asylum processing rules',
    headline: 'DHS Announces New Asylum Processing Rules, Sets 6-Month Decision Timeline',
    summary: 'The Department of Homeland Security issued a rule requiring immigration judges to issue initial asylum decisions within six months of filing, replacing an open-ended review process.',
    body: `The Department of Homeland Security published a final rule on Tuesday giving immigration judges six months to reach an initial decision on an asylum claim. Until now, no clock ran at all.

The change lands on a system buckling under its own weight. As of March, 3.8 million cases sat pending in immigration court, according to the Transactional Records Access Clearinghouse at Syracuse University, which tracks the data. Cases routinely take years.

DHS frames the deadline as a fix. The rule, the department said, restores integrity and efficiency to a system under severe strain. The country's immigration lawyers see it differently. The American Immigration Lawyers Association called six months operationally unrealistic given how thinly the courts are staffed, and warned that complex cases could be decided without adequate review.

The rule also reshuffles the order in which cases are heard. For an 18-month transition, newly filed claims move to the front of the line, ahead of older pending ones — a step DHS says is meant to keep the backlog from growing while the existing pile is worked down separately.

Whether the rule survives is an open question. Immigration advocacy groups and several states said they are weighing legal challenges. It takes effect 60 days after publication.`,
    key_facts: [
      'DHS final rule sets 6-month timeline for initial asylum decisions',
      'Immigration court backlog stood at 3.8 million cases as of March 2026',
      'Rule takes effect 60 days after Federal Register publication',
    ],
    references: [
      'Federal Register — text of the final rule',
      'TRAC (Syracuse University) — immigration court backlog data',
      'Reuters — DHS Secretary statement',
      'NPR — American Immigration Lawyers Association response',
      'Associated Press — effective date and transition docket',
    ],
    outlet_count: 16,
    sources_used: ['reuters', 'ap', 'nyt', 'wsj', 'npr'],
    grok_review_score: 9.0,
    grok_reviewer: 'grok',
    validation_approved: true,
    validation_confidence: 9.2,
    validation_neutrality: 'Excellent',
    validation_notes: 'Both government and advocacy perspectives included. TRAC data correctly attributed. Neutral language throughout.',
    validation_reviewed_at: '2026-06-03T07:55:00Z',
    published_at: '2026-06-03T08:00:00Z',
  },
]
