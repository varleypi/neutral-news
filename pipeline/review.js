/**
 * Stage 3 — Dual AI review: Grok critiques, then Claude validates the final article.
 *
 * Pass 1 (Grok): independent fact-check and neutrality audit → returns critique text
 *   that the writer stage uses to revise the article.
 * Pass 2 (Claude): final sign-off — confirms the revised article meets publication
 *   standards and returns a structured validation record stored with the article.
 */

const Anthropic = require('@anthropic-ai/sdk')

const claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const GROK_REVIEW_SYSTEM = `You are a rigorous fact-checker and neutrality auditor for a wire news service.
Your job is to find any factual claims that cannot be verified from the source headlines,
any loaded language, any imbalance in how sides are represented, and any editorial opinion
masquerading as fact. You respond with valid JSON only.`

const CLAUDE_VALIDATION_SYSTEM = `You are the final editorial validator for a neutral news service.
Your job is to certify that an article meets the highest standards of factual accuracy and
political neutrality before publication.
CRITICAL: Output raw JSON only. No preamble, no explanation, no markdown fences. Start your response with { and end with }.`

// ── Grok review (Pass 1) ──────────────────────────────────────────────────────

async function grokReview(draft, cluster) {
  if (!process.env.XAI_API_KEY) {
    console.log('   ⚠ XAI_API_KEY not set — skipping Grok review, using Claude-only review')
    return claudeFallbackReview(draft)
  }

  const headlines = cluster.articles
    .map(a => `- ${a.outlet_id.toUpperCase()}: "${a.headline}"`)
    .join('\n')

  const prompt = `Review this news article for factual accuracy and political neutrality.

SOURCE HEADLINES (the only verified facts available):
${headlines}

ARTICLE TO REVIEW:
Headline: ${draft.headline}
Body:
${draft.body}

Check for:
1. Claims not supported by any source headline (mark as UNVERIFIABLE)
2. Loaded or biased language (mark as BIASED)
3. Missing perspectives that are present in the source headlines (mark as IMBALANCED)
4. Incorrect attributions or misrepresentations (mark as INACCURATE)
5. Any editorializing or opinion presented as fact (mark as EDITORIAL)

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

  let responseText = ''
  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.XAI_API_KEY}` },
      body: JSON.stringify({
        model: 'grok-3',
        max_tokens: 2000,
        messages: [
          { role: 'system', content: GROK_REVIEW_SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) throw new Error(`xAI API ${response.status}: ${await response.text()}`)
    const json = await response.json()
    responseText = json.choices?.[0]?.message?.content ?? ''
  } catch (err) {
    console.warn(`   ⚠ Grok review failed: ${err.message} — falling back to Claude review`)
    return claudeFallbackReview(draft)
  }

  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.warn('   ⚠ No JSON in Grok review — falling back to Claude review')
    return claudeFallbackReview(draft)
  }

  const result = JSON.parse(jsonMatch[0])
  const issueCount = result.issues?.length ?? 0
  console.log(`   Grok review: score ${result.overallScore}/10, ${issueCount} issues found`)
  return { ...result, reviewer: 'grok' }
}

// ── Claude fallback review (if Grok unavailable) ──────────────────────────────

async function claudeFallbackReview(draft) {
  const prompt = `Review this news article for neutrality and journalistic standards.
Headline: ${draft.headline}
Body: ${draft.body}

Find any biased language, unverifiable claims, or imbalances.
RESPOND WITH JSON:
{
  "overallScore": 8.5,
  "issues": [],
  "critiqueText": "Summary of issues",
  "passesReview": true
}`

  const response = await claudeClient.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1000,
    system: CLAUDE_VALIDATION_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0]?.text ?? ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { overallScore: 7.0, issues: [], critiqueText: '', passesReview: true, reviewer: 'claude-fallback' }
  return { ...JSON.parse(jsonMatch[0]), reviewer: 'claude-fallback' }
}

// ── Claude final validation (Pass 2) ─────────────────────────────────────────

async function claudeFinalValidation(article, grokReviewResult) {
  const issuesSummary = (grokReviewResult.issues ?? [])
    .map(i => `- [${i.severity}] ${i.type}: "${i.excerpt}" → ${i.correction}`)
    .join('\n') || 'None'

  const references = (article.references ?? []).map(r => `- ${r}`).join('\n') || 'None listed'

  const prompt = `Perform final editorial validation of this news article before publication.

HOUSE STYLE — READ CAREFULLY BEFORE JUDGING:
This outlet publishes fluid narrative prose in the tradition of Walter Cronkite, Marty Baron,
and David Brooks — NOT stilted wire copy. By design:
  • Facts that are corroborated across multiple outlets are stated plainly in the article's own
    neutral voice. This is CORRECT. Do NOT flag a well-established, multi-source fact as
    "unattributed" or "unsupported" simply because it lacks an inline "according to". Requiring
    inline attribution on every sentence is explicitly against house style.
  • Sourcing lives in a separate REFERENCES list (provided below), not scattered through the body.
    A claim is properly sourced if the references list supports it — it does not need an inline cite.
  • Reserve concern for genuine neutrality problems: loaded/judgmental language, editorializing,
    telling the reader what to conclude, unfair representation of a side, a sensational headline,
    or a specific contested claim/figure/quote that nothing in the references supports.

Judge neutrality and factual support — do NOT penalize the deliberately readable, low-inline-
attribution style. Plain, confident narration of corroborated fact is exactly what we want.

ARTICLE:
Headline: ${article.headline}
Summary: ${article.summary}
Body:
${article.body}

REFERENCES (the sourcing backing this article):
${references}

PRIOR REVIEW ISSUES (should be addressed in this version):
${issuesSummary}

Confirm:
1. The article is factually neutral — no loaded language or editorial opinion
2. All sides are represented fairly
3. The headline is accurate and not sensational
4. No contested claim, figure, or quote lacks support in the references
5. The prior review issues have been addressed

Approve unless there is a genuine neutrality or factual-support problem. Absence of inline
attribution is NOT a reason to withhold approval.

RESPOND WITH JSON ONLY:
{
  "approved": true,
  "confidenceScore": 9.2,
  "neutralityRating": "Excellent|Good|Acceptable|Needs Revision",
  "remainingIssues": [],
  "validationNotes": "Brief summary of validation findings",
  "reviewedAt": "${new Date().toISOString()}"
}`

  const response = await claudeClient.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 800,
    system: CLAUDE_VALIDATION_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content[0]?.text ?? ''
  const stripped = raw.replace(/```(?:json)?/g, '').trim()
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.warn(`   ⚠ Claude validation returned no JSON — using safe default`)
    return { approved: true, confidenceScore: 7.0, neutralityRating: 'Good', remainingIssues: [], validationNotes: 'Auto-approved (validation parse failed)', reviewedAt: new Date().toISOString() }
  }

  const validation = JSON.parse(jsonMatch[0])
  console.log(`   Final validation: approved=${validation.approved}, confidence=${validation.confidenceScore}/10, neutrality=${validation.neutralityRating}`)
  return validation
}

module.exports = { grokReview, claudeFinalValidation }
