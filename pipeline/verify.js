/**
 * Stage 3b — Verify the article's standalone factual claims against the live web.
 *
 * This stage exists because of a specific failure. On 2026-10-19 the pipeline
 * asserted that SpaceX "remains privately held, meaning its shares do not trade
 * on public markets" — in a story about the market value of SpaceX shares, four
 * months after the company listed on Nasdaq. Every check in the pipeline was
 * blind to it for the same reason: the writer's only input was a handful of
 * source headlines, and the only other knowledge in the system was model
 * training data that predated the listing. Grok could say "nothing in the
 * sources supports this". Nobody could say "this is false".
 *
 * So the pipeline now retrieves. This stage pulls out the assertions the
 * article makes in its own voice — the background facts a model fills in when
 * five headlines have to become five hundred words — and checks each one
 * against current sources before the gate decides anything.
 *
 * Verdicts:
 *   CONTRADICTED — current sources say otherwise. An absolute block; see gate.js.
 *   UNVERIFIED   — nothing found either way. Becomes a required issue: remove it
 *                  or support it from the references.
 *   SUPPORTED    — current sources agree. Fine to publish.
 */

const {
  completeWithSearch,
  parseSearchResponse,
  collectSearchErrors,
  VERIFIER_MODEL,
} = require('./claude')

// This is the stage the whole change exists for, and the only one whose job is
// genuinely to reason about evidence. It keeps full effort while the writing
// stages run lower.
const VERIFY_EFFORT = process.env.CLAUDE_VERIFY_EFFORT || 'high'

const VERIFY_SYSTEM = `You are a fact-checker with live web access, working for a neutral news service.

You check whether what an article asserts is actually TRUE RIGHT NOW. This is different
from checking whether it is well written or well sourced — it is the question of whether
the world currently matches the sentence.

Treat your own background knowledge as a lead to investigate, never as a verdict. Company
ownership, officeholders, prices, legal status, troop positions, team rosters, who is alive,
what is public or private — these change, and your training data has a cutoff. If a claim is
the kind of thing that can change, search for it even when you feel certain. Feeling certain
about a stale fact is the exact failure you are here to prevent.

You respond with valid JSON only.`

/**
 * Claims worth the cost of a search: the ones the article asserts on its own
 * authority. A direct quote or a figure attributed to a named outlet is the
 * reviewer's problem; an unattributed statement about how the world is, is ours.
 */
function buildVerifyPrompt(article, cluster, today) {
  const headlines = cluster.articles
    .map(a => `- ${a.outlet_id.toUpperCase()}: "${a.headline}"`)
    .join('\n')

  return `Today's date is ${today}. Verify the factual claims in this article against current sources.

SOURCE HEADLINES behind the story (these are what the outlets reported):
${headlines}

ARTICLE:
Headline: ${article.headline}
Summary: ${article.summary}

Body:
${article.body}

Key facts asserted:
${(article.keyFacts ?? []).map(f => `- ${f}`).join('\n') || '- none listed'}

WHAT TO CHECK
Identify every STANDALONE FACTUAL ASSERTION — a statement the article makes in its own
voice about the state of the world, rather than a report of what someone said. Prioritise:
  • Status claims: what a company, person, law, or organisation currently is.
  • Ownership, listing, valuation, and market claims.
  • Dates, founding years, tenures, counts, and monetary figures.
  • Negative claims ("no filings have been reported", "no one has confirmed") — these are
    assertions about the world too, and a model cannot know them without looking.
  • Any background context that does not appear in the source headlines above. If the
    headlines do not contain it, the writer supplied it from memory, which is exactly the
    material that goes stale.

Do NOT flag: direct quotes, claims the article explicitly attributes to a named outlet or
official, or matters of framing and emphasis. Those are handled elsewhere.

HOW TO CHECK
Search the web for each claim. Prefer primary sources — company investor relations pages,
regulatory filings, official statements — then established news outlets. For anything that
could have changed recently, check for news later than your training data.

BUDGET — SPEND IT ON WHAT MATTERS
You have a limited number of searches. Triage before you start: rank the assertions by how
much damage a wrong one would do, and work down that list. A stale ownership or status claim
outranks a precise-sounding detail, which outranks routine colour. Check AT MOST the 12 most
consequential, and say in the summary if you left others unchecked.

VERDICTS
  "CONTRADICTED" — current sources show the claim is false or out of date. Say what is
                   actually the case in the "evidence" field.
  "UNVERIFIED"   — you actually searched for this one and found nothing that settles it.
  "UNCHECKED"    — you ran out of search budget before reaching it. This is NOT a finding
                   about the claim; it is a report about you. Never use it for something you
                   searched for and could not confirm — that is "UNVERIFIED".
  "SUPPORTED"    — current sources confirm it.

The UNVERIFIED/UNCHECKED split matters: one says the world has no answer, the other says you
did not get to ask. Reporting a budget failure as a finding sends the pipeline off to rewrite
a sentence that was probably fine.

Be decisive. "CONTRADICTED" is for a claim the evidence actually contradicts, not one you
merely could not confirm.

RESPOND WITH JSON ONLY, as the last thing in your reply:
{
  "claims": [
    {
      "claim": "the assertion, in your own words",
      "excerpt": "the exact text from the article that makes it",
      "verdict": "SUPPORTED|CONTRADICTED|UNVERIFIED|UNCHECKED",
      "evidence": "what the sources show; for CONTRADICTED, state the current fact",
      "sources": ["https://..."]
    }
  ],
  "summary": "One or two sentences on what you checked and what you found."
}`
}

/**
 * Verify an article. Never throws: a verification failure is reported as a
 * non-ok status, which the gate treats as a blocker in its own right. Losing
 * the check must not silently become permission to publish.
 */
async function verifyClaims(article, cluster, { date } = {}) {
  const today = date || new Date().toISOString().split('T')[0]

  try {
    // No schema here, deliberately - see completeWithSearch in ./claude. This
    // is the stage whose answer has to come out of what it just retrieved, and
    // the one call that measured search-plus-schema came back schema-shaped
    // and wrong.
    //
    // maxUses 8 was starvation. The second pilot hit "search access was
    // exhausted" five times on a 19-claim article, and every starved claim
    // came back UNVERIFIED - which the pipeline read as a factual problem and
    // spent a revision, a re-check and a retry on. Giving this stage enough
    // searches the first time is the cheapest fix in the system.
    const { content, stopReason, sources: retrieved } = await completeWithSearch({
      model: VERIFIER_MODEL,
      system: VERIFY_SYSTEM,
      prompt: buildVerifyPrompt(article, cluster, today),
      maxUses: Number(process.env.VERIFY_MAX_SEARCHES) || 24,
      effort: VERIFY_EFFORT,
    })

    const searchErrors = collectSearchErrors(content)
    if (searchErrors.length > 0) {
      console.warn(`   ⚠ Web search reported: ${searchErrors.join(', ')}`)
    }

    if (retrieved.length === 0) {
      // No retrieval happened, so this run proves nothing about staleness.
      return {
        status: 'no_sources_retrieved',
        error: searchErrors.join(', ') || `model made no searches (stop_reason: ${stopReason})`,
        claims: [],
      }
    }

    const parsed = parseSearchResponse(content, stopReason, 'Claim verification')
    const claims = (parsed.claims ?? []).map(c => ({
      claim: c.claim ?? '',
      excerpt: c.excerpt ?? '',
      verdict: ['SUPPORTED', 'CONTRADICTED', 'UNVERIFIED', 'UNCHECKED'].includes(c.verdict) ? c.verdict : 'UNVERIFIED',
      evidence: c.evidence ?? '',
      // Only credit URLs the model actually retrieved — otherwise a remembered
      // citation could launder a remembered fact straight past the gate.
      sources: (c.sources ?? []).filter(u => retrieved.includes(u)),
    }))

    const counts = claims.reduce((acc, c) => ({ ...acc, [c.verdict]: (acc[c.verdict] ?? 0) + 1 }), {})
    console.log(
      `   Claim verification: ${claims.length} claim(s) checked across ${retrieved.length} source(s) — ` +
      `${counts.SUPPORTED ?? 0} supported, ${counts.CONTRADICTED ?? 0} contradicted, ` +
      `${counts.UNVERIFIED ?? 0} unverified, ${counts.UNCHECKED ?? 0} unchecked`
    )
    // Distinguishing this from a factual finding is the point: it tells the
    // operator to raise the budget rather than to go looking for a bad claim.
    if (counts.UNCHECKED > 0) {
      console.warn(
        `   ⚠ ${counts.UNCHECKED} claim(s) went unchecked for want of search budget — ` +
        `raise VERIFY_MAX_SEARCHES (currently ${Number(process.env.VERIFY_MAX_SEARCHES) || 24})`
      )
    }
    for (const c of claims.filter(c => c.verdict === 'CONTRADICTED')) {
      console.log(`   ✗ CONTRADICTED: ${c.claim} — ${c.evidence}`)
    }

    return {
      status: 'ok',
      claims,
      summary: parsed.summary ?? '',
      sourcesRetrieved: retrieved,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.warn(`   ⚠ Claim verification failed: ${err.message}`)
    return { status: 'failed', error: err.message, claims: [] }
  }
}

/**
 * Fold verification results into the fact-check issue list.
 *
 * An UNVERIFIED standalone claim is the same problem Grok's UNVERIFIABLE flag
 * was pointing at, so it joins the same queue and has to be resolved the same
 * way — removed, or supported from the references. CONTRADICTED claims are not
 * included: they are not negotiable and the gate handles them directly.
 */
function verificationIssues(verification) {
  return (verification?.claims ?? [])
    .filter(c => c.verdict === 'UNVERIFIED' || c.verdict === 'UNCHECKED')
    .map(c => ({
      type: c.verdict,
      severity: 'required',
      excerpt: c.excerpt,
      correction: c.verdict === 'UNCHECKED'
        ? `The verifier ran out of search budget before reaching this, so nothing is known about it either way. Support it from a listed reference, or remove it.`
        : `Could not be confirmed against current sources. Remove it, or support it from a listed reference. (${c.evidence || 'no corroborating source found'})`,
    }))
}

module.exports = { verifyClaims, verificationIssues }
