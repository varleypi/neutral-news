/**
 * Stage 2 — Write a neutral, factual article for a story cluster.
 *
 * Claude receives all headlines + bias signals for the cluster and writes
 * a tightly structured article adhering to AP style and inverted-pyramid form.
 * Called twice: initial draft, then a revision pass incorporating Grok's critique.
 */

const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a senior wire-service journalist writing for a neutral, factual news outlet.
Your mandate is radical neutrality: report only what is verifiably true, use only neutral verbs,
attribute every claim to a named source, and give equal weight to all sides.
You write in AP style. You never editorialize. You respond with valid JSON only.`

function buildDraftPrompt(cluster) {
  const headlines = cluster.articles
    .map(a => `- ${a.outlet_id.toUpperCase()}: "${a.headline}" (bias score: ${a.bias_score}/10)`)
    .join('\n')

  return `Write a neutral, factual news article about this story cluster.

STORY TOPIC: ${cluster.topicLabel}
OUTLET COVERAGE: ${cluster.outletCount} news outlets

SOURCE HEADLINES (with political bias scores 0=far-left, 10=far-right, 5=center):
${headlines}

WRITING STANDARDS — MANDATORY:
1. Inverted pyramid: most important facts first
2. No adjectives that carry judgment (e.g. "radical", "extreme", "brave", "corrupt")
3. All claims must be attributed: "according to [source]", "[name] said", "officials stated"
4. If sources conflict, note the conflict neutrally: "X said A; Y disputes this, saying B"
5. No passive voice used to hide agency: say who did what
6. No loaded verbs: use "said" not "claimed/insisted/admitted/slammed"
7. No speculation about motives
8. Headline must be factual, no sensationalism, no loaded words
9. 300–500 words

RESPOND WITH JSON ONLY:
{
  "headline": "Factual headline, AP style",
  "summary": "One sentence, 25 words max, the essential facts",
  "body": "Full article text with paragraph breaks as \\n\\n",
  "keyFacts": ["Verified fact 1", "Verified fact 2", "Verified fact 3"],
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

Apply all corrections and respond with JSON only (same schema as before):
{
  "headline": "...",
  "summary": "...",
  "body": "...",
  "keyFacts": ["...", "...", "..."],
  "sourcesUsed": ["..."]
}`
}

async function writeDraft(cluster) {
  console.log(`   Writing draft for: "${cluster.topicLabel}"`)
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2000,
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
    max_tokens: 2000,
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
