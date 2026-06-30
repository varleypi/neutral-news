/**
 * Stage 2 — Write a neutral, factual article for a story cluster.
 *
 * Claude receives all headlines + bias signals for the cluster and writes
 * a tightly structured article adhering to AP style and inverted-pyramid form.
 * Called twice: initial draft, then a revision pass incorporating Grok's critique.
 */

const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a senior newswriter for a neutral, factual news outlet. Your writing
voice blends three sensibilities:
  • Walter Cronkite — calm, plainspoken authority; short declarative sentences; a steady narrative
    that carries the reader through the event as it unfolded.
  • Marty Baron — rigorous, accountable, fact-first editing; nothing asserted that the sourcing
    does not support; precision over flourish.
  • David Brooks — fluid, readable prose that explains why something matters and connects facts
    into a coherent story, without ever telling the reader what to think.

Your mandate is radical neutrality combined with genuine readability. Report only what is
verifiably true and give fair weight to all sides — but write it as flowing narrative prose a
person actually enjoys reading, NOT as a stilted wire dispatch clogged with "according to" on
every line. You never editorialize, never use loaded verbs, never speculate about motives.
You respond with valid JSON only.`

function buildDraftPrompt(cluster) {
  const headlines = cluster.articles
    .map(a => `- ${a.outlet_id.toUpperCase()}: "${a.headline}" (bias score: ${a.bias_score}/10)`)
    .join('\n')

  return `Write a neutral, factual, highly readable news article about this story cluster.

STORY TOPIC: ${cluster.topicLabel}
OUTLET COVERAGE: ${cluster.outletCount} news outlets

SOURCE HEADLINES (with political bias scores 0=far-left, 10=far-right, 5=center):
${headlines}

READABILITY — THE CENTRAL GOAL:
Write flowing narrative prose, not a wire dispatch. The reader should move through the story
without tripping over an attribution in every sentence. Achieve this by:
  • Stating well-established, multi-outlet facts plainly in the outlet's own neutral voice.
    When most sources agree a thing happened, simply report that it happened — you do NOT need
    "according to reports" hung on a fact corroborated across many outlets.
  • Reserving explicit, named attribution for the things that genuinely need it: direct quotes,
    contested claims, figures, predictions, and any point where sources disagree.
  • Opening with a clear, human lede that tells the reader what happened and why it matters,
    then unfolding the story in a logical narrative arc.
  • Writing in the calm, authoritative, plainspoken register of Walter Cronkite, with the
    fluency of David Brooks and the factual discipline of Marty Baron.

NEUTRALITY — NON-NEGOTIABLE:
1. No judgment-carrying adjectives ("radical", "extreme", "brave", "corrupt", "historic").
2. Neutral verbs only — "said", not "claimed/insisted/admitted/slammed".
3. When sources genuinely conflict, present both accounts fairly and let them stand.
4. No passive voice that hides who did what. No speculation about motives.
5. Headline: factual, no sensationalism, no loaded words.
6. 350–550 words of readable prose.

REFERENCES:
Do NOT litter the body with inline citations. Instead, collect the sourcing in a "references"
list returned separately. Each reference names the outlet and what it supports, so a reader can
trace any claim back to coverage without the body being cluttered.

RESPOND WITH JSON ONLY:
{
  "headline": "Factual, readable headline",
  "summary": "One sentence, 25 words max, the essential facts",
  "body": "Flowing narrative prose with paragraph breaks as \\n\\n. Minimal inline attribution.",
  "keyFacts": ["Verified fact 1", "Verified fact 2", "Verified fact 3"],
  "references": [
    "Outlet name — what this source reported or corroborated",
    "Outlet name — the quote or contested figure it supports"
  ],
  "sourcesUsed": ["outlet_id1", "outlet_id2"]
}`
}

function buildRevisionPrompt(draft, critique) {
  return `Revise this news article based on the fact-checker's critique below.
Apply every correction marked as required. For disputed corrections, use your judgment
to improve neutrality without introducing new inaccuracies.

ORIGINAL ARTICLE:
Headline: ${draft.headline}
Body:
${draft.body}

FACT-CHECKER CRITIQUE:
${critique}

Preserve the flowing, readable narrative voice (Cronkite/Baron/Brooks) — do not revert to a
stilted wire style with an attribution on every line. Keep sourcing in the references list, not
scattered through the body.

Apply all corrections and respond with JSON only (same schema as before):
{
  "headline": "...",
  "summary": "...",
  "body": "...",
  "keyFacts": ["...", "...", "..."],
  "references": ["Outlet — what it supports", "..."],
  "sourcesUsed": ["..."]
}`
}

async function writeDraft(cluster) {
  console.log(`   Writing draft for: "${cluster.topicLabel}"`)
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildDraftPrompt(cluster) }],
  })

  const text = response.content[0]?.text ?? ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in Claude draft response`)

  const draft = JSON.parse(jsonMatch[0])
  console.log(`   Draft written: "${draft.headline}"`)
  return draft
}

async function reviseWithCritique(draft, critique) {
  console.log(`   Revising article based on fact-check critique...`)
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildRevisionPrompt(draft, critique) }],
  })

  const text = response.content[0]?.text ?? ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in Claude revision response`)

  const revised = JSON.parse(jsonMatch[0])
  console.log(`   Revised: "${revised.headline}"`)
  return revised
}

module.exports = { writeDraft, reviseWithCritique }
