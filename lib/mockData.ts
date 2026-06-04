import { NeutralArticle } from './types'

export const MOCK_ARTICLES: NeutralArticle[] = [
  {
    id: 1,
    date: '2026-06-03',
    cluster_id: 'federal-budget-vote',
    topic_label: 'Congress votes on federal budget bill',
    headline: 'Senate Passes Federal Budget Bill 52-48 After Three-Day Debate',
    summary: 'The Senate approved a $1.7 trillion federal budget after three days of floor debate, with the bill now moving to the president for signature.',
    body: `The United States Senate passed a $1.7 trillion federal budget bill Tuesday by a vote of 52 to 48, according to the Senate clerk's office. The vote followed three days of floor debate over spending levels for defense, social programs, and infrastructure.

Senate Majority Leader stated the bill reflects "responsible fiscal policy," according to a statement released by the leader's office. The minority party's leadership said in a separate statement that the legislation "increases the deficit without meaningful reform."

The nonpartisan Congressional Budget Office estimated the bill would add $280 billion to the federal deficit over ten years. CBO's estimate was disputed by the bill's primary sponsor, who said the projection does not account for projected economic growth.

Under the legislation, defense spending would increase by 4 percent and domestic discretionary spending would remain flat, adjusted for inflation. Funding for the Department of Transportation would increase by $12 billion, according to the bill text.

The bill now goes to the president, who has not stated publicly whether he will sign or veto it. A White House spokesperson said the administration is "reviewing the final text." The bill requires the president's signature or a two-thirds congressional override to become law.`,
    key_facts: [
      'Senate voted 52-48 to pass the $1.7 trillion budget bill',
      'CBO estimated the bill adds $280 billion to the deficit over ten years',
      'Defense spending increases 4%; domestic discretionary spending stays flat',
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
    body: `The Federal Reserve announced Wednesday it would leave its benchmark interest rate unchanged at 4.5%, following the conclusion of its two-day Federal Open Market Committee meeting.

Federal Reserve Chair Jerome Powell said at a press conference that the decision reflects "the need to assess incoming data" before making further adjustments. Powell noted that inflation, as measured by the Personal Consumption Expenditures index, stood at 2.7% in April, above the Fed's stated 2% target.

The unemployment rate was 4.1% in May, according to the Bureau of Labor Statistics, within the range the Fed has previously described as consistent with its full-employment mandate.

Three FOMC members dissented from the decision to hold rates steady. Two members favored a 0.25-percentage-point rate cut, citing slowing consumer spending data. One member favored a rate increase, citing persistent inflation above target, according to the FOMC statement.

Markets had priced in a 78% probability of no change ahead of the announcement, according to CME Group's FedWatch tool. Following the announcement, the S&P 500 index fell 0.4%.`,
    key_facts: [
      'Fed held benchmark rate at 4.5% following FOMC meeting',
      'PCE inflation was 2.7% in April, above the 2% target',
      'Three members dissented: two for a cut, one for a hike',
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
    body: `NATO member states agreed Thursday to raise the alliance's minimum defense spending target from 2% to 3% of gross domestic product, according to the final communiqué issued at the conclusion of the two-day NATO summit in Brussels.

The 32-member alliance set a 2030 deadline for all members to reach the new threshold. Nineteen of 32 members currently meet the existing 2% target, according to NATO's 2026 annual report published ahead of the summit.

NATO Secretary General Jens Stoltenberg described the commitment as "the most significant increase in the alliance's collective defense investment in a generation," according to a statement from NATO. Several member states' defense ministers told reporters the new target reflects the security environment following Russia's 2022 invasion of Ukraine.

The agreement does not carry legal enforcement mechanisms. A senior official from one member state, speaking on condition of anonymity because they were not authorized to speak publicly, said the commitment is "political, not binding," and that the mechanism for monitoring compliance remains unchanged from the current 2% framework.

Member states will submit implementation plans to NATO by the end of 2026, according to the communiqué.`,
    key_facts: [
      '32 NATO members unanimously agreed to raise spending floor to 3% of GDP',
      '19 of 32 members currently meet the existing 2% target',
      'Deadline set for 2030; commitment is political, not legally binding',
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
    body: `The United States Supreme Court ruled 6 to 3 Tuesday that federal agencies must receive explicit congressional authorization before issuing significant regulations, in a decision that builds on the Court's 2024 ruling in Loper Bright Enterprises v. Raimondo.

The majority opinion, authored by Chief Justice John Roberts, held that agency rulemaking authority cannot be inferred from broad statutory language when a regulation has "major economic or political significance," a standard the Court declined to define with numerical precision. The ruling applies to all executive branch agencies.

Justice Sonia Sotomayor wrote the lead dissent, joined by Justices Elena Kagan and Ketanji Brown Jackson. The dissent argued the decision "dismantles decades of regulatory law" and transfers substantial authority from the executive branch to the judiciary to determine which rules require additional congressional action.

The case involved an Environmental Protection Agency rule limiting methane emissions from oil and gas facilities. That specific rule was vacated by the Court's ruling. The EPA said in a statement it would "work with Congress and within existing statutory authority" to address the ruling.

Legal scholars said in interviews that the decision will require Congress to pass more detailed legislation when it intends agencies to issue major rules, a process that could take years for existing regulatory regimes.`,
    key_facts: [
      'Court ruled 6-3 agencies need explicit congressional authorization for major rules',
      'The EPA methane emissions rule was vacated by the decision',
      'Dissent argued ruling transfers authority from executive to judicial branch',
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
    body: `The Department of Homeland Security on Tuesday published a final rule requiring immigration judges to issue initial decisions on asylum applications within six months of filing, according to the rule published in the Federal Register.

The rule replaces a prior system in which no statutory timeline applied to initial decisions. As of March 2026, the immigration court backlog stood at 3.8 million pending cases, according to the Transactional Records Access Clearinghouse at Syracuse University, which tracks immigration court data.

DHS Secretary stated the rule "restores integrity and efficiency to a system under severe strain," according to a DHS press release. The American Immigration Lawyers Association said in a statement the six-month timeline is "operationally unrealistic" given current court staffing and may lead to inadequate review of complex cases.

The rule also establishes a priority docketing system that places recently filed cases ahead of older pending claims during an 18-month transition period. The DHS said the transition is intended to reduce future accumulation while the backlog is addressed separately.

Immigration advocacy groups and several states said they are reviewing the rule for potential legal challenges. The rule takes effect 60 days after publication.`,
    key_facts: [
      'DHS final rule sets 6-month timeline for initial asylum decisions',
      'Immigration court backlog stood at 3.8 million cases as of March 2026',
      'Rule takes effect 60 days after Federal Register publication',
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
