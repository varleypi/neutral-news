/**
 * Cheap diagnostics for the expensive stages.
 *
 * Why this exists: the fixes that followed the 2026-10-19 incident were
 * validated by running the whole pipeline against three real clusters, twice.
 * Each run took one to two hours and made something like thirty search-backed
 * model calls, and in both cases the thing it proved could have been settled by
 * two calls against a fixture — that Grok answers at all, that the verifier
 * catches a known-false claim. Using the daily pipeline as a debugging loop was
 * an expensive way to read a config value back.
 *
 * Each probe below asks one question with a known answer, and the whole file
 * costs about two model calls to run.
 *
 *   node pipeline/probe.js            # everything
 *   node pipeline/probe.js gate       # free, no API calls
 *   node pipeline/probe.js verify     # 1 call
 *   node pipeline/probe.js grok       # 1 call
 *
 * Exits non-zero if any probe fails, so CI shows red.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })

const { client, VERIFIER_MODEL, CORRECTOR_MODEL, webSearchTool, usageRows } = require('./claude')
const { writeDraft, applyCorrections, CORRECTIONS_MAX_TOKENS } = require('./write')
const { verifyClaims } = require('./verify')
const { grokReview } = require('./review')
const { evaluateGate } = require('./gate')

// ── The fixture ──────────────────────────────────────────────────────────────
// The article as actually published on 2026-10-19, wrong sentence and all.
// SpaceX listed on Nasdaq as SPCX on 2026-06-12; every published word below
// about its ownership was four months out of date.

const SPACEX_EXCERPT =
  'SpaceX, which he founded in 2002, remains privately held, meaning its shares do not ' +
  'trade on public markets and have historically been held by employees, early investors, ' +
  'and institutional backers.'

const SPACEX_ARTICLE = {
  headline: 'Musk Says He Will Give Every American Child One Share of SpaceX',
  summary: 'Elon Musk said he will give one of his SpaceX shares to every child in America next year.',
  body:
    'Elon Musk said Sunday that he intends to give one of his SpaceX shares to every child ' +
    'in America, a pledge he described as the first of many.\n\n' +
    SPACEX_EXCERPT + '\n\n' +
    'As of now, the pledge exists only as a public statement from Musk. SpaceX has not ' +
    'issued a separate corporate announcement outlining a formal program, and no regulatory ' +
    'filings describing such a distribution have been reported.',
  keyFacts: [
    'Musk said he will give one SpaceX share to each child in the US.',
    'SpaceX is privately held; shares do not trade on public markets.',
  ],
  references: ['MarketWatch — covered the pledge and its impact on institutional shareholders'],
}

const SPACEX_CLUSTER = {
  clusterId: 'probe-spacex',
  topicLabel: 'Musk vows to give SpaceX share to every US child',
  outletCount: 3,
  articles: [
    { outlet_id: 'marketwatch', headline: "Musk's SpaceX share pledge could ripple through endowments", bias_score: 5 },
    { outlet_id: 'newsweek', headline: 'Elon Musk pledges SpaceX share for every child in America — what they are worth', bias_score: 5 },
    { outlet_id: 'tnw', headline: 'Musk says he will give a SpaceX share to every child in America next year', bias_score: 5 },
  ],
}

const PROBE_DATE = '2026-10-19'

// ── Probes ───────────────────────────────────────────────────────────────────

/**
 * Free. The gate's own tests cover this in more detail; this is here so a probe
 * run with no API key still checks something real.
 */
async function probeGate() {
  const { passed, blockers } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: {
      issues: [{ type: 'UNVERIFIABLE', severity: 'required', excerpt: SPACEX_EXCERPT, correction: 'Remove it.' }],
    },
    validation: {
      approved: true,
      confidenceScore: 8.8,
      requiredIssueDispositions: [{
        excerpt: SPACEX_EXCERPT,
        disposition: 'supported',
        evidenceType: 'none',
        evidenceRef: '',
        note: 'Widely corroborated public facts.',
      }],
    },
    verification: { status: 'ok', claims: [] },
  })

  if (passed) return { ok: false, detail: 'the 10/19 waiver was accepted — the gate is not holding' }
  return { ok: true, detail: `blocked: ${blockers.map(b => b.kind).join(', ')}` }
}

/**
 * One call. The question the whole change exists to answer: shown a confidently
 * stated, four-months-stale fact, does the verifier notice?
 */
async function probeVerify() {
  const verification = await verifyClaims(SPACEX_ARTICLE, SPACEX_CLUSTER, { date: PROBE_DATE })

  if (verification.status !== 'ok') {
    return { ok: false, detail: `verification did not complete: ${verification.status} — ${verification.error}` }
  }

  const listing = (verification.claims ?? [])
    .filter(c => c.verdict !== 'SUPPORTED')
    .map(c => `       [${c.verdict}] ${c.claim}`)
    .join('\n')

  const caught = (verification.claims ?? []).find(
    c => c.verdict === 'CONTRADICTED' && /privat|public market|trade|listed|nasdaq|spcx/i.test(`${c.claim} ${c.excerpt}`)
  )

  if (!caught) {
    return {
      ok: false,
      detail: `the stale ownership claim was NOT marked CONTRADICTED ` +
        `(${verification.claims?.length ?? 0} claims, ${verification.sourcesRetrieved?.length ?? 0} sources)` +
        (listing ? `\n${listing}` : ''),
    }
  }

  const config = `${VERIFIER_MODEL}, budget ${process.env.VERIFY_MAX_SEARCHES || 'default'}, ${verification.sourcesRetrieved?.length ?? 0} sources`
  return {
    ok: true,
    detail: `caught it [${config}] — "${caught.evidence}"`,
  }
}

/**
 * One call. Grok has never once completed a review: the first pilot died on a
 * retired request parameter, the second on a two-minute client abort. Both
 * times the pipeline fell through to Claude and carried on as though it had two
 * independent reviewers. This asks the only question that matters — did Grok
 * actually answer?
 */
async function probeGrok() {
  if (!process.env.XAI_API_KEY) return { ok: false, detail: 'XAI_API_KEY not set' }

  const started = Date.now()
  const review = await grokReview(SPACEX_ARTICLE, SPACEX_CLUSTER, { date: PROBE_DATE })
  const seconds = ((Date.now() - started) / 1000).toFixed(0)

  if (review.reviewer !== 'grok') {
    return { ok: false, detail: `fell back to "${review.reviewer}" after ${seconds}s — Grok is still not reviewing` }
  }
  return {
    ok: true,
    detail: `Grok answered in ${seconds}s — score ${review.overallScore}/10, ` +
      `${review.issues?.length ?? 0} issue(s), ${review.sourcesConsulted?.length ?? 0} source(s)`,
  }
}

/**
 * One call, and it decides a design.
 *
 * master guarantees parseable JSON with structured outputs; this branch needs
 * server-side web search. The docs describe structured outputs alongside STRICT
 * CLIENT tools and say nothing either way about server tools, so the only
 * honest way to know whether the two compose is to send one request that uses
 * both. If it works, every stage can have schema-guaranteed output. If it 400s,
 * the searching stages keep a text parser and only the others get schemas.
 */
async function probeSchema() {
  const schema = {
    type: 'object',
    properties: { ticker: { type: 'string' }, listed: { type: 'boolean' } },
    required: ['ticker', 'listed'],
    additionalProperties: false,
  }

  try {
    const response = await client.messages.create({
      model: VERIFIER_MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      tools: [webSearchTool(2)],
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{
        role: 'user',
        content: 'Search the web for the ticker symbol SpaceX trades under, and whether it is publicly listed.',
      }],
    })

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
    const searched = response.content.some(b => b.type === 'web_search_tool_result')

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, detail: `accepted both, but the output was not schema JSON (stop_reason: ${response.stop_reason}): ${text.slice(0, 160)}` }
    }

    return {
      ok: true,
      detail: `structured outputs AND web search compose` +
        ` (searched: ${searched}, got ${JSON.stringify(parsed)}) — schemas can be used everywhere`,
    }
  } catch (err) {
    // A 400 here is the answer, not a failure of the probe.
    const incompatible = err?.status === 400
    return {
      ok: !incompatible ? false : true,
      detail: incompatible
        ? `INCOMPATIBLE (400): ${err.message.slice(0, 220)}
       -> searching stages keep the text parser; non-tool stages get schemas`
        : `probe could not reach a verdict: ${err.message}`,
    }
  }
}

/**
 * One call, on the combination with the least evidence behind it.
 *
 * The writer is the only stage that uses server-side search AND a schema in
 * anger, and the probe that established the two compose came back
 * schema-shaped and wrong. So this asks the end-to-end question instead of the
 * API one: given the same cluster that produced the 10/19 article, does a
 * searching writer still assert that SpaceX is privately held?
 */
async function probeDraft() {
  const draft = await writeDraft(SPACEX_CLUSTER, { date: PROBE_DATE })

  if (!draft.headline || !draft.body) {
    return { ok: false, detail: `draft came back malformed: ${JSON.stringify(draft).slice(0, 160)}` }
  }

  const text = `${draft.body} ${(draft.keyFacts ?? []).join(' ')}`
  const stale = /privately held|not (?:publicly )?traded|do(?:es)? not trade on public markets|remains private/i.exec(text)

  if (stale) {
    return {
      ok: false,
      detail: `the writer still asserted stale ownership: "${stale[0]}" ` +
        `(${draft.researchSources?.length ?? 0} source(s) consulted) - the gate would have to catch this downstream`,
    }
  }

  return {
    ok: true,
    detail: `"${draft.headline}" - ${draft.researchSources?.length ?? 0} source(s) consulted, ` +
      `${draft.keyFacts?.length ?? 0} key fact(s), no stale ownership claim`,
  }
}

/**
 * One call, on the failure that cost the 2026-10-24 edition.
 *
 * Eight of twelve candidates were blocked that day, and the validator's
 * refrain was the same each time: "None of the four REQUIRED fixes were
 * applied; all flagged passages remain verbatim in the article." Asking for a
 * rewrite got the original back, twice.
 *
 * So: hand the correction step the published SpaceX article and the required
 * issue that was raised against it, and check the article afterwards. Not the
 * model's account of what it did - the text.
 */
async function probeCorrections() {
  const issue = {
    type: 'UNVERIFIABLE',
    severity: 'required',
    excerpt: SPACEX_EXCERPT,
    correction: 'SpaceX is publicly traded on Nasdaq as SPCX since June 2026. Remove or correct this.',
  }

  const { article, applied, unresolved } = await applyCorrections(SPACEX_ARTICLE, [issue], { date: PROBE_DATE })

  const text = `${article.body} ${(article.keyFacts ?? []).join(' ')}`

  // Look for the falsehood, not the words. "SpaceX was privately held until it
  // listed in June 2026" is a correct sentence that contains the phrase; only
  // the present tense is wrong.
  const survived = /(?:is|remains|stays)\s+privately\s+held|shares\s+do\s+not\s+trade|is\s+not\s+publicly\s+traded/i.exec(text)

  const how = applied.map(a => `${a.action}${a.ok ? '' : ` FAILED(${a.reason})`}`).join(', ') || 'no resolutions'

  if (survived) {
    return {
      ok: false,
      detail: [
        `the claim survived as "${survived[0]}" [${how}]`,
        `       body: ${article.body.replace(/\s+/g, ' ').slice(0, 200)}`,
        `       keyFacts: ${JSON.stringify(article.keyFacts)}`,
      ].join('\n'),
    }
  }

  if (unresolved.length > 0) {
    return { ok: false, detail: `${unresolved.length} required issue(s) left unresolved` }
  }

  return {
    ok: true,
    detail: `${CORRECTOR_MODEL}: flagged claim gone [${how}]; ` +
      `body ${SPACEX_ARTICLE.body.length} -> ${article.body.length} chars, ` +
      `keyFacts ${SPACEX_ARTICLE.keyFacts.length} -> ${article.keyFacts.length}`,
  }
}

// The 2026-10-30 Alphabet article, reduced to the shape that deadlocked it:
// the flagged claim is in the summary, and the body says the opposite. Nothing
// a correction pass did to the body could remove it, so the gate blocked the
// article on every attempt - twice, at full price, before giving up.
const DEADLOCK_ARTICLE = {
  headline: 'Alphabet Shares Tumble After Earnings Beat Raises Questions About AI Spending',
  summary:
    'Alphabet shares fell sharply after a $55-billion-plus AI capital spending plan ' +
    'unsettled investors, wiping out upwards of $500 billion in market value.',
  body:
    'Alphabet shares closed sharply lower on Thursday after third-quarter results.\n\n' +
    'The company maintained its full-year 2026 capital spending range of $195 billion ' +
    'to $205 billion, unchanged since July. Third-quarter capital expenditure was ' +
    '$51.4 billion.\n\n' +
    'Analysts had expected quarterly capital spending of about $55 billion.',
  keyFacts: [
    'Alphabet kept its 2026 capex range at $195-205 billion.',
    'Third-quarter capital expenditure was $51.4 billion.',
  ],
  references: ['CNBC — reported Q3 results and the analyst capex expectation'],
}

/**
 * The deadlock: a required claim that lives in the summary, not the body.
 *
 * Before the restatement step this could not come out however many passes ran,
 * because corrections only ever edited the body while the gate read the
 * headline and summary too. A pass here means the claim is gone from the whole
 * article and nothing is left unresolved - i.e. the gate would now let it
 * through instead of blocking it forever.
 */
async function probeDeadlock() {
  const issue = {
    type: 'UNVERIFIED',
    severity: 'required',
    excerpt: 'a $55-billion-plus AI capital spending plan',
    correction:
      'The $55 billion figure is the analyst expectation for quarterly capex, not a ' +
      'company spending plan. Alphabet\'s stated 2026 plan is $195-205 billion.',
  }

  const { article, unresolved } = await applyCorrections(DEADLOCK_ARTICLE, [issue], { date: PROBE_DATE })

  const whole = `${article.headline} ${article.summary} ${article.body} ${(article.keyFacts ?? []).join(' ')}`
  const problems = []

  // The falsehood, not the digits: "$55 billion was what analysts expected" is
  // a correct sentence containing the number.
  if (/\$55[- ]billion[- ]plus|\$55 billion(?![^.]*\b(analyst|expect|estimate))/i.test(whole)) {
    problems.push('the mischaracterised $55bn plan is still asserted')
  }
  if (unresolved.length > 0) problems.push(`${unresolved.length} required issue(s) still unresolved`)
  if (!String(article.headline ?? '').trim()) problems.push('headline came back empty')
  if (!String(article.summary ?? '').trim()) problems.push('summary came back empty')
  // A restatement may only restate. A figure that is in neither the body nor
  // the original summary would be a fresh unverified claim, which is the one
  // way this step could do harm.
  const invented = (String(article.summary).match(/\$[\d.]+[- ]?(?:billion|million|trillion)/gi) ?? [])
    .filter(fig => !DEADLOCK_ARTICLE.body.includes(fig.replace(/-/g, ' ')) && !DEADLOCK_ARTICLE.body.includes(fig))
  if (invented.length > 0) problems.push(`restatement introduced figures absent from the body: ${invented.join(', ')}`)

  if (problems.length > 0) {
    return {
      ok: false,
      detail: [
        `${CORRECTOR_MODEL}: ${problems.join('; ')}`,
        `       headline: ${article.headline}`,
        `       summary:  ${article.summary}`,
      ].join('\n'),
    }
  }

  return {
    ok: true,
    detail: `${CORRECTOR_MODEL}: claim gone from summary, nothing unresolved\n` +
      `       headline: ${article.headline}\n` +
      `       summary:  ${article.summary}`,
  }
}

/**
 * The same stage given several passages at once.
 *
 * One flagged passage is the easy case, and it is not the case that hurt. The
 * failure that blocked most of an edition was required corrections coming back
 * unapplied - a model handed five passages answering three, or paraphrasing an
 * excerpt so `locateExcerpt` could not find the sentence it meant. Both get
 * likelier with more passages and a smaller model, and neither shows up in a
 * single-issue probe, so a model swap on this stage has to clear this one too.
 */
// ── The load-bearing fixture ─────────────────────────────────────────────────
// Proposition 40, from the 2026-10-31 edition. That run flagged 12 required
// corrections on this story and the stage died with "hit its output cap before
// returning JSON" — one of nine identical deaths that published nothing.
//
// Twelve is the point. The first version of this probe handed corrections three
// passages, passed, and was read as evidence that moving the stage to Haiku was
// safe. Real editions flag 10 to 19. A probe standing in for an expensive stage
// is only evidence at the size that stage actually runs at, and three was not a
// smaller version of twelve - it was a different question.
//
// Sentences are declared once here and used both to build the body and to quote
// the flagged passages, so no excerpt can drift from the text. The earlier probe
// quoted a sub-sentence clause by hand; corrections works on runs of whole
// sentences and could never locate it, and the failure read as a verdict on the
// model rather than a bug in the fixture.
const PROP40_SENTENCES = [
  { text: 'California voters will decide Tuesday on Proposition 40, a ballot measure that would impose an annual tax of 5 percent on personal wealth above $1 billion.' },
  {
    text: 'Supporters say the measure would raise roughly $100 billion a year, enough to close the state budget shortfall on its own.',
    flag: { type: 'UNVERIFIABLE', correction: 'The revenue figure is a campaign projection, and "enough to close the shortfall on its own" is the article drawing its own conclusion from it. Attribute both or cut them.' },
  },
  {
    text: 'The tax would reach about 200 California residents.',
    flag: { type: 'UNSOURCED', correction: 'No cited source gives this count. Source it or cut it.' },
  },
  {
    text: 'Every serious economist agrees that a wealth tax of this design is unenforceable.',
    flag: { type: 'BIASED', correction: 'This is an overreach stated as consensus. Replace it with what specific named economists have actually said, or cut it.' },
  },
  {
    text: 'Governor Newsom has declined to take a position on the measure.',
    flag: { type: 'CONTRADICTED', correction: 'Newsom publicly opposed the measure at a press conference on October 28. Correct this.' },
  },
  { text: 'The measure has divided California Democrats, with legislative leaders split over whether to back it.' },
  {
    text: 'A similar bill died in the legislature in 2024 after the largest public employee unions in the state withdrew their support.',
    flag: { type: 'UNVERIFIABLE', correction: 'The reason given for the 2024 bill failing is not supported by the cited reporting. Source the causal claim or state only that the bill failed.' },
  },
  {
    text: 'Opponents have spent more than $80 million on television advertising, the largest sum ever recorded in a California ballot fight.',
    flag: { type: 'UNVERIFIABLE', correction: 'The "largest ever" superlative is unsupported. Keep the spending figure if it is sourced and drop the ranking.' },
  },
  {
    text: 'Billionaires would simply leave the state and take their tax receipts with them.',
    flag: { type: 'BIASED', correction: 'This states an argument made by opponents as the prediction of the article itself. Attribute it or cut it.' },
  },
  {
    text: 'Early voting has already broken every record in California history.',
    flag: { type: 'UNVERIFIABLE', correction: 'Unsupported superlative. Give the sourced early-voting figure instead, or cut it.' },
  },
  { text: 'Polling released last week showed the measure leading by four points, inside the margin of error of the survey.' },
  { text: 'The Legislative Analyst Office of the state has said the revenue estimate is highly uncertain and could vary by tens of billions of dollars.' },
  {
    text: 'Turnout among voters under 30 has doubled against the last midterm election.',
    flag: { type: 'UNVERIFIABLE', correction: 'No cited source supports a doubling. Source it or cut it.' },
  },
  {
    text: 'If it passes, California becomes the first state in the country to tax wealth directly.',
    flag: { type: 'UNVERIFIABLE', correction: 'Other states have enacted narrower wealth-adjacent taxes. Qualify the claim precisely or cut it.' },
  },
  {
    text: 'Constitutional challenges are certain to follow within days of the vote.',
    flag: { type: 'UNSOURCED', correction: 'Speculation stated as certainty. Attribute the expectation to a named party or cut it.' },
  },
  {
    text: 'The author of the measure has said privately that she expects the tax to be struck down.',
    flag: { type: 'UNSOURCED', correction: 'A private remark cannot be sourced and should not be reported as fact. Cut it.' },
  },
  { text: 'Three other statewide measures are on the same ballot.' },
]

const PROP40_ARTICLE = {
  headline: 'California Decides Tuesday on a Wealth Tax That Has Split Its Democrats',
  summary:
    'Proposition 40 would tax personal wealth above $1 billion each year. Democrats in the ' +
    'state are divided over it, and polling puts the result inside the margin of error.',
  // Two sentences to a paragraph, the shape the writer stage produces.
  body: PROP40_SENTENCES
    .map(s => s.text)
    .reduce((paras, text, i) => {
      if (i % 2 === 0) paras.push(text)
      else paras[paras.length - 1] += ' ' + text
      return paras
    }, [])
    .join('\n\n'),
  keyFacts: [
    'Proposition 40 would tax personal wealth above $1 billion at 5 percent a year.',
    'California Democrats are split on the measure, and recent polling is inside the margin of error.',
  ],
  references: [
    'CalMatters — covered the split among legislative Democrats',
    'Legislative Analyst Office — published the revenue uncertainty estimate',
  ],
}

const PROP40_ISSUES = PROP40_SENTENCES
  .filter(s => s.flag)
  .map(s => ({ ...s.flag, severity: 'required', excerpt: s.text }))

/** Output tokens the corrections stage has spent so far in this process. */
function correctionsOutputTokens() {
  return usageRows()
    .filter(r => r.stage === 'corrections')
    .reduce((n, r) => n + r.output, 0)
}

/**
 * The probe that should have existed before corrections moved to Haiku: the
 * stage at the scale a real edition hands it.
 *
 * It fails if the false claim survives, if any passage is left unresolved, if
 * any excerpt could not be located - and, by throwing out of applyCorrections,
 * if the stage runs out of output budget before returning its JSON. That last
 * one is what took the 2026-10-31 edition to zero articles.
 */
async function probeCorrectionsMulti() {
  const issues = PROP40_ISSUES
  const before = correctionsOutputTokens()

  const { article, applied, unresolved } = await applyCorrections(PROP40_ARTICLE, issues, { date: PROBE_DATE })

  const spent = correctionsOutputTokens() - before
  const text = [article.headline, article.summary, article.body, ...(article.keyFacts ?? [])].join('\n')
  const failedToLocate = applied.filter(a => !a.ok)

  const problems = []
  if (/every serious economist/i.test(text)) problems.push('the "every serious economist" overreach survived')
  // A passage with no resolution is a required issue the gate blocks on, which
  // is the other way this stage stalls an edition.
  if (unresolved.length > 0) problems.push(`${unresolved.length}/${issues.length} passage(s) left unresolved`)
  if (failedToLocate.length > 0) {
    problems.push(
      `${failedToLocate.length} excerpt(s) could not be located: ` +
      failedToLocate.map(a => JSON.stringify(a.excerpt.slice(0, 48) + '…')).join(', ')
    )
  }

  // Report the headroom either way. A pass with a few hundred tokens to spare
  // is a pass that the next busy news day turns back into a dead edition, and
  // that is worth seeing before it happens rather than after.
  const pct = Math.round((spent / CORRECTIONS_MAX_TOKENS) * 100)
  const headroom = `${spent} output tokens, ${pct}% of the ${CORRECTIONS_MAX_TOKENS} cap`

  if (problems.length > 0) {
    return { ok: false, detail: `${CORRECTOR_MODEL}: ${problems.join('; ')} [${headroom}]` }
  }

  return {
    ok: true,
    detail:
      `${CORRECTOR_MODEL}: all ${issues.length} passages resolved and located; ${headroom}; ` +
      `body ${PROP40_ARTICLE.body.length} -> ${article.body.length} chars, ` +
      `keyFacts ${PROP40_ARTICLE.keyFacts.length} -> ${article.keyFacts.length}`,
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

const PROBES = {
  gate: { run: probeGate, cost: 'free' },
  verify: { run: probeVerify, cost: '1 call' },
  grok: { run: probeGrok, cost: '1 call' },
  schema: { run: probeSchema, cost: '1 call' },
  draft: { run: probeDraft, cost: '1 call' },
  corrections: { run: probeCorrections, cost: '1 call' },
  'corrections-multi': { run: probeCorrectionsMulti, cost: '1 call, 12 passages' },
  deadlock: { run: probeDeadlock, cost: '2 calls' },
}

async function main() {
  const requested = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const names = requested.length > 0 ? requested : Object.keys(PROBES)

  const unknown = names.filter(n => !PROBES[n])
  if (unknown.length > 0) {
    console.error(`Unknown probe(s): ${unknown.join(', ')}. Available: ${Object.keys(PROBES).join(', ')}`)
    process.exit(2)
  }

  console.log(`\nPROBE — ${names.join(', ')}\n${'='.repeat(60)}`)
  let failed = 0

  for (const name of names) {
    const { run, cost } = PROBES[name]
    process.stdout.write(`\n[${name}] (${cost})\n`)
    try {
      const { ok, detail } = await run()
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${detail}`)
      if (!ok) failed++
    } catch (err) {
      console.log(`  FAIL  threw: ${err.message}`)
      failed++
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(failed === 0 ? `All ${names.length} probe(s) passed` : `${failed} of ${names.length} probe(s) failed`)
  process.exit(failed === 0 ? 0 : 1)
}

if (require.main === module) {
  main().catch(err => {
    console.error('Probe runner failed:', err)
    process.exit(1)
  })
}

module.exports = { PROP40_ARTICLE, PROP40_ISSUES }
