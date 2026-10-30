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

const { client, VERIFIER_MODEL, CORRECTOR_MODEL, webSearchTool } = require('./claude')
const { writeDraft, applyCorrections } = require('./write')
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

// ── Runner ───────────────────────────────────────────────────────────────────

const PROBES = {
  gate: { run: probeGate, cost: 'free' },
  verify: { run: probeVerify, cost: '1 call' },
  grok: { run: probeGrok, cost: '1 call' },
  schema: { run: probeSchema, cost: '1 call' },
  draft: { run: probeDraft, cost: '1 call' },
  corrections: { run: probeCorrections, cost: '1 call' },
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

main().catch(err => {
  console.error('Probe runner failed:', err)
  process.exit(1)
})
