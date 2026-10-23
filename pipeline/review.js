/**
 * Stage 3 — Dual AI review: Grok critiques, then Claude validates the final article.
 *
 * Pass 1 (Grok): independent fact-check and neutrality audit → returns critique text
 *   that the writer stage uses to revise the article. Grok now runs with live search,
 *   so it can check a claim against the world and not only against the source headlines.
 * Pass 2 (Claude): final sign-off. It no longer decides on its own whether the article
 *   ships — it produces a structured account of what happened to each required issue,
 *   and ./gate.js checks that account against the article and against retrieved evidence.
 *
 * On the validation stage's reduced authority: it previously ended with "Approve unless
 * there is a genuine neutrality or factual-support problem", plus an instruction not to
 * flag well-established multi-source facts. Faced with Grok's required flag on "SpaceX
 * remains privately held", it followed those instructions exactly — called the claim a
 * "widely corroborated public fact" on the strength of its own training data, and
 * approved. The waiver language is gone, and what remains of it is enforced in code.
 */

const {
  MODEL,
  client: claudeClient,
  MAX_TOKENS,
  webSearchTool,
  extractJson,
  parseStageResponse,
  collectSearchSources,
  createWithTools,
} = require('./llm')

const GROK_MODEL = process.env.GROK_MODEL || 'grok-4.7'

const GROK_REVIEW_SYSTEM = `You are a rigorous fact-checker and neutrality auditor for a wire news service.
You have live web access — use it. Your job is to find claims that are false or out of date,
claims that cannot be verified, loaded language, imbalance in how sides are represented, and
editorial opinion masquerading as fact.

Your own background knowledge has a cutoff and the article you are checking may describe
something that changed after it. When an article states a fact about the current state of the
world — who owns what, what is public or private, who holds an office, what something costs —
search for it rather than judging it from memory. You respond with valid JSON only.`

const CLAUDE_VALIDATION_SYSTEM = `You are the final editorial validator for a neutral news service.
You certify factual accuracy and political neutrality before publication, and you account for
what happened to each issue the fact-checker raised.
CRITICAL: Output raw JSON only. No preamble, no explanation, no markdown fences. Start your response with { and end with }.`

// ── Grok review (Pass 1) ──────────────────────────────────────────────────────

/**
 * xAI's Responses API returns a list of output items rather than a single
 * message. Walk it tolerantly: collect every bit of text and every cited URL,
 * without assuming one exact shape.
 */
function parseXaiResponse(json) {
  const texts = []
  const urls = []

  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    if (typeof node.text === 'string') texts.push(node.text)
    if (typeof node.url === 'string') urls.push(node.url)
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v)
  }

  if (typeof json?.output_text === 'string') texts.push(json.output_text)
  visit(json?.output)
  visit(json?.citations)

  return { text: texts.join('\n'), sources: [...new Set(urls)] }
}

function buildGrokPrompt(draft, cluster, today) {
  const headlines = cluster.articles
    .map(a => `- ${a.outlet_id.toUpperCase()}: "${a.headline}"`)
    .join('\n')

  return `Today's date is ${today}. Review this news article for factual accuracy and political neutrality.

SOURCE HEADLINES (what the outlets actually reported):
${headlines}

ARTICLE TO REVIEW:
Headline: ${draft.headline}
Body:
${draft.body}

Check for:
1. Claims that are factually wrong or out of date — search to confirm (mark as INACCURATE)
2. Claims not supported by any source headline and not confirmed by search (mark as UNVERIFIABLE)
3. Loaded or biased language (mark as BIASED)
4. Missing perspectives that are present in the source headlines (mark as IMBALANCED)
5. Any editorializing or opinion presented as fact (mark as EDITORIAL)

Pay particular attention to background context the article supplies that is not in the
headlines above — founding dates, ownership and listing status, valuations, who currently
holds a position. That material comes from the writer's memory, and memory goes stale.

RESPOND WITH JSON ONLY:
{
  "overallScore": 8.5,
  "issues": [
    {
      "type": "BIASED|UNVERIFIABLE|IMBALANCED|INACCURATE|EDITORIAL",
      "severity": "required|suggested",
      "excerpt": "exact text from the article that is problematic",
      "correction": "how to fix it"
    }
  ],
  "critiqueText": "Plain text summary of all issues for the writer to address",
  "passesReview": true
}`
}

async function grokReview(draft, cluster, { date } = {}) {
  const today = date || new Date().toISOString().split('T')[0]

  if (!process.env.XAI_API_KEY) {
    console.log('   ⚠ XAI_API_KEY not set — skipping Grok review, using Claude-only review')
    return claudeFallbackReview(draft, today)
  }

  let parsed
  try {
    const response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.XAI_API_KEY}` },
      // Exactly the documented Responses-API shape. The first pilot also sent
      // `search_parameters`, the old Live Search config, and every call came
      // back 410 "Live search is deprecated" — so Grok never reviewed anything
      // and silently fell through to the Claude path all day. Tools only.
      body: JSON.stringify({
        model: GROK_MODEL,
        input: [
          { role: 'system', content: GROK_REVIEW_SYSTEM },
          { role: 'user', content: buildGrokPrompt(draft, cluster, today) },
        ],
        tools: [{ type: 'web_search' }],
      }),
      signal: AbortSignal.timeout(120000),
    })

    if (!response.ok) {
      const body = await response.text()
      // 4xx here is a configuration problem, not a blip: a retired parameter,
      // a bad key, a model this account cannot reach. Falling through quietly
      // means the pipeline runs all day with one reviewer instead of two and
      // nothing says so — which is exactly what the first pilot did.
      if (response.status >= 400 && response.status < 500) {
        console.error(
          `   ✗ xAI rejected the request (${response.status}) — this is a configuration problem, not a transient one:
` +
          `     ${body.slice(0, 300)}
` +
          `     Grok is NOT reviewing; every article today gets the Claude fallback only.`
        )
      }
      throw new Error(`xAI API ${response.status}: ${body}`)
    }
    parsed = parseXaiResponse(await response.json())
  } catch (err) {
    console.warn(`   ⚠ Grok review failed: ${err.message} — falling back to Claude review`)
    return claudeFallbackReview(draft, today)
  }

  let result
  try {
    result = extractJson(parsed.text)
  } catch {
    console.warn('   ⚠ No parseable JSON in Grok review — falling back to Claude review')
    return claudeFallbackReview(draft, today)
  }

  const issueCount = result.issues?.length ?? 0
  console.log(
    `   Grok review: score ${result.overallScore}/10, ${issueCount} issues found` +
    (parsed.sources.length ? ` (${parsed.sources.length} source(s) consulted)` : ' (no sources consulted)')
  )
  return { ...result, reviewer: 'grok', sourcesConsulted: parsed.sources }
}

// ── Claude fallback review (if Grok unavailable) ──────────────────────────────

/**
 * The fallback also searches. Losing Grok should cost us a second opinion, not
 * the ability to notice that a fact has changed.
 *
 * A failure here returns `passesReview: false` and a required issue. The old
 * version returned a 7.0 pass on a parse failure, which meant an article could
 * reach the validator carrying a clean bill of health that nothing had issued.
 */
async function claudeFallbackReview(draft, today) {
  const prompt = `Today's date is ${today}. Review this news article for factual accuracy and neutrality.

Headline: ${draft.headline}
Body: ${draft.body}

Search the web to check any claim about the current state of the world — ownership, listing
status, officeholders, prices, legal status. Your training data has a cutoff; the article may
describe something that has since changed. Then find any biased language, unverifiable claims,
or imbalances.

RESPOND WITH JSON ONLY, as the last thing in your reply:
{
  "overallScore": 8.5,
  "issues": [
    { "type": "BIASED|UNVERIFIABLE|IMBALANCED|INACCURATE|EDITORIAL",
      "severity": "required|suggested",
      "excerpt": "exact text from the article",
      "correction": "how to fix it" }
  ],
  "critiqueText": "Summary of issues",
  "passesReview": true
}`

  try {
    const { content, stopReason } = await createWithTools({
      model: MODEL,
      thinking: { type: 'adaptive' },
      system: CLAUDE_VALIDATION_SYSTEM,
      tools: [webSearchTool(6)],
      messages: [{ role: 'user', content: prompt }],
    })

    const result = parseStageResponse(content, stopReason, 'Fallback review')
    return { ...result, reviewer: 'claude-fallback', sourcesConsulted: collectSearchSources(content) }
  } catch (err) {
    console.warn(`   ⚠ Claude fallback review failed: ${err.message}`)
    return {
      overallScore: 0,
      issues: [{
        type: 'UNVERIFIABLE',
        severity: 'required',
        excerpt: draft.headline,
        correction: `No fact-check completed for this article (${err.message}). It cannot be published unreviewed.`,
      }],
      critiqueText: `Fact-check did not run: ${err.message}`,
      passesReview: false,
      reviewer: 'none',
      sourcesConsulted: [],
    }
  }
}

// ── Claude final validation (Pass 2) ─────────────────────────────────────────

/**
 * Final validation. Note what this no longer does: decide.
 *
 * It reports, per required issue, what became of it — and the gate checks that
 * report against the article text and against URLs the verifier actually
 * retrieved. A validator that says "removed" about text still in the body, or
 * "supported" with nothing but its own confidence behind it, now fails the
 * article instead of passing it.
 */
async function claudeFinalValidation(article, grokReviewResult, { verification, date } = {}) {
  const today = date || new Date().toISOString().split('T')[0]

  const required = (grokReviewResult.issues ?? []).filter(i => i.severity === 'required')
  const suggested = (grokReviewResult.issues ?? []).filter(i => i.severity !== 'required')

  const requiredList = required
    .map((i, n) => `${n + 1}. [${i.type}] "${i.excerpt}"\n   → required fix: ${i.correction}`)
    .join('\n') || 'None'
  const suggestedList = suggested
    .map(i => `- [${i.type}] "${i.excerpt}" → ${i.correction}`)
    .join('\n') || 'None'

  const references = (article.references ?? []).map((r, n) => `[R${n + 1}] ${r}`).join('\n') || 'None listed'

  const verifiedLines = (verification?.claims ?? [])
    .map(c => `- [${c.verdict}] "${c.claim}" — ${c.evidence}${c.sources?.length ? ` (${c.sources.join(', ')})` : ''}`)
    .join('\n') || 'No claim verification available'

  const prompt = `Today's date is ${today}. Perform final editorial validation of this news article.

HOUSE STYLE — what is and is not a problem:
This outlet publishes fluid narrative prose, not stilted wire copy. Sourcing lives in a
separate REFERENCES list rather than inline. So the ABSENCE OF AN INLINE "according to" IS
NOT A DEFECT, and you should not treat it as one.

That is a point about STYLE. It says nothing about whether a claim is TRUE or whether anything
actually backs it. Do not extend it into a reason to keep a claim. In particular:

  • Your own knowledge is NOT evidence. "This is well known", "widely corroborated",
    "a matter of public record" — these are memory, and your memory has a cutoff. A claim
    is supported when a listed REFERENCE or a VERIFIED CLAIM below supports it, and not
    otherwise.
  • A fact being uncontested is not the same as a fact being current. Company ownership,
    listing status, officeholders and prices all change quietly.

ARTICLE:
Headline: ${article.headline}
Summary: ${article.summary}
Body:
${article.body}

Key facts asserted:
${(article.keyFacts ?? []).map(f => `- ${f}`).join('\n') || '- none listed'}

REFERENCES (the sourcing behind this article):
${references}

CLAIM VERIFICATION (checked against live sources — this is external evidence you may cite):
${verifiedLines}

REQUIRED ISSUES raised by the fact-checker — you must account for every one:
${requiredList}

SUGGESTED ISSUES (judgement calls; no accounting needed):
${suggestedList}

YOUR TASK
For each REQUIRED issue, report what actually became of it:
  "removed"   — the flagged text is no longer in the article.
  "corrected" — the passage was rewritten so the problem no longer applies.
  "supported" — the text is still there, and external evidence backs it. Only valid if you
                can name that evidence: set evidenceType to "reference" and evidenceRef to
                the reference entry, or evidenceType to "verification" and evidenceRef to a
                source URL from the CLAIM VERIFICATION section above. If you cannot name
                one, the honest disposition is not "supported".

Your report is checked mechanically against the article text and against the retrieved
sources, so a disposition that does not match what is in the article will fail the article
rather than pass it. Report what is true, not what you would like to be true.

Then judge the article overall: neutrality, fair representation of sides, a headline that is
accurate and not sensational.

RESPOND WITH JSON ONLY:
{
  "approved": true,
  "confidenceScore": 9.2,
  "neutralityRating": "Excellent|Good|Acceptable|Needs Revision",
  "requiredIssueDispositions": [
    {
      "excerpt": "the exact excerpt from the required issue, echoed back",
      "disposition": "removed|corrected|supported",
      "evidenceType": "reference|verification|none",
      "evidenceRef": "the reference entry or source URL, or empty",
      "note": "one line on what happened"
    }
  ],
  "remainingIssues": [],
  "validationNotes": "Brief summary of validation findings",
  "reviewedAt": "${new Date().toISOString()}"
}`

  try {
    const response = await claudeClient.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system: CLAUDE_VALIDATION_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    })

    const validation = parseStageResponse(response.content, response.stop_reason, 'Final validation')
    console.log(
      `   Final validation: approved=${validation.approved}, confidence=${validation.confidenceScore}/10, ` +
      `neutrality=${validation.neutralityRating}, ${validation.requiredIssueDispositions?.length ?? 0}/${required.length} required issue(s) accounted for`
    )
    return validation
  } catch (err) {
    // A validation that did not complete is not a validation that passed.
    console.warn(`   ⚠ Claude validation failed: ${err.message}`)
    return {
      approved: false,
      confidenceScore: 0,
      neutralityRating: 'Needs Revision',
      requiredIssueDispositions: [],
      remainingIssues: [`Validation did not complete: ${err.message}`],
      validationNotes: `Validation did not complete: ${err.message}`,
      reviewedAt: new Date().toISOString(),
    }
  }
}

module.exports = { grokReview, claudeFinalValidation }
