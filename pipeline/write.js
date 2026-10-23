/**
 * Stage 2 — Write a neutral, factual article for a story cluster.
 *
 * Claude receives all headlines + bias signals for the cluster and writes
 * a tightly structured article adhering to AP style and inverted-pyramid form.
 * Called twice: initial draft, then a revision pass incorporating the critique.
 *
 * The writer now has web search. The reason is arithmetic: a cluster supplies a
 * handful of headlines, and the house format asks for 350–550 words of flowing
 * prose. Everything in the gap between those two numbers used to come out of the
 * model's memory, stated plainly in the outlet's own voice because house style
 * says corroborated facts need no inline attribution. That is how "SpaceX
 * remains privately held" was published four months after the Nasdaq listing.
 * Giving the writer retrieval closes the gap at its source, rather than leaving
 * every downstream check to catch invented background after the fact.
 */

const {
  MODEL,
  webSearchTool,
  parseStageResponse,
  collectSearchSources,
  createWithTools,
} = require('./llm')

// Drafting and revision are writing tasks, not reasoning tasks: the research is
// done by search, not by thinking harder. Medium effort keeps them from
// dominating the run's wall-clock, which on the first pilot they did.
const WRITE_EFFORT = process.env.CLAUDE_WRITE_EFFORT || 'medium'

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

You have web search. Use it before asserting any background fact you did not get from the
source headlines. Your training data has a cutoff and the world moves: ownership changes,
companies list, officeholders leave, prices move. A background fact you are confident about
is exactly the kind you should check, because confidence is what stale knowledge feels like.

You respond with valid JSON only.`

function buildDraftPrompt(cluster, today) {
  const headlines = cluster.articles
    .map(a => `- ${a.outlet_id.toUpperCase()}: "${a.headline}" (bias score: ${a.bias_score}/10)`)
    .join('\n')

  return `Today's date is ${today}. Write a neutral, factual, highly readable news article about this story cluster.

STORY TOPIC: ${cluster.topicLabel}
OUTLET COVERAGE: ${cluster.outletCount} news outlets

SOURCE HEADLINES (with political bias scores 0=far-left, 10=far-right, 5=center):
${headlines}

RESEARCH FIRST:
The headlines above are the spine of the story, but they are not enough to write 400 words
from. Search the web before you draft:
  • Confirm what actually happened, and pick up detail the headlines only gesture at.
  • Check every piece of background you are about to supply — company status, ownership,
    valuations, dates, titles, who currently holds what office. Verify as of ${today}, not as
    of whenever your training data ends.
  • If you cannot confirm a background fact, LEAVE IT OUT. A shorter article is better than a
    confident wrong one, and an unsupported sentence will be caught downstream and cost the
    story its slot.

READABILITY — THE CENTRAL GOAL:
Write flowing narrative prose, not a wire dispatch. The reader should move through the story
without tripping over an attribution in every sentence. Achieve this by:
  • Stating well-established, multi-outlet facts plainly in the outlet's own neutral voice.
    When sources agree a thing happened — and you have confirmed it — simply report that it
    happened. You do NOT need "according to reports" hung on a corroborated fact.
  • Reserving explicit, named attribution for the things that genuinely need it: direct quotes,
    contested claims, figures, predictions, and any point where sources disagree.
  • Opening with a clear, human lede that tells the reader what happened and why it matters,
    then unfolding the story in a logical narrative arc.
  • Writing in the calm, authoritative, plainspoken register of Walter Cronkite, with the
    fluency of David Brooks and the factual discipline of Marty Baron.

Plain narration is a licence to drop the attribution, NOT a licence to assert something you
have not checked. The two are easy to confuse and the difference is the whole job.

NEUTRALITY — NON-NEGOTIABLE:
1. No judgment-carrying adjectives ("radical", "extreme", "brave", "corrupt", "historic").
2. Neutral verbs only — "said", not "claimed/insisted/admitted/slammed".
3. When sources genuinely conflict, present both accounts fairly and let them stand.
4. No passive voice that hides who did what. No speculation about motives.
5. Headline: factual, no sensationalism, no loaded words.
6. 350–550 words of readable prose.

Do not write negative claims about the world you cannot check — "no filings have been
reported", "no one has confirmed". Absence of evidence is a research finding, not a fact you
can assume.

REFERENCES:
Do NOT litter the body with inline citations. Instead, collect the sourcing in a "references"
list returned separately. Each reference names the outlet or source and what it supports, so a
reader can trace any claim back to coverage without the body being cluttered. Include anything
you confirmed by search, with its publication.

RESPOND WITH JSON ONLY, as the last thing in your reply:
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

function buildRevisionPrompt(draft, critique, today) {
  return `Today's date is ${today}. Revise this news article based on the fact-checker's critique below.

ORIGINAL ARTICLE:
Headline: ${draft.headline}
Body:
${draft.body}

Key facts asserted:
${(draft.keyFacts ?? []).map(f => `- ${f}`).join('\n') || '- none listed'}

FACT-CHECKER CRITIQUE:
${critique}

HOW TO APPLY IT:
Every correction marked "required" must actually be applied. There are two honest ways to
apply one, and only two:
  • Remove or rewrite the flagged text so the problem is gone.
  • Confirm it by search and add the source to the references list.

Arguing that a flagged claim is well known is not a third option. Your confidence in a
background fact is not evidence for it, and the check downstream compares the critique
against the article text — a required correction left in place costs the story its slot, so
there is nothing to be gained by leaving it. When in doubt, cut the sentence: the article
does not need it.

For corrections marked "suggested", use your judgment to improve the piece without
introducing new inaccuracies.

Preserve the flowing, readable narrative voice (Cronkite/Baron/Brooks) — do not revert to a
stilted wire style with an attribution on every line. Keep sourcing in the references list,
not scattered through the body.

Respond with JSON only (same schema as before), as the last thing in your reply:
{
  "headline": "...",
  "summary": "...",
  "body": "...",
  "keyFacts": ["...", "...", "..."],
  "references": ["Outlet — what it supports", "..."],
  "sourcesUsed": ["..."]
}`
}

async function writeDraft(cluster, { date } = {}) {
  const today = date || new Date().toISOString().split('T')[0]
  console.log(`   Writing draft for: "${cluster.topicLabel}"`)

  const { content, stopReason } = await createWithTools({
    model: MODEL,
    thinking: { type: 'adaptive' },
    output_config: { effort: WRITE_EFFORT },
    system: SYSTEM_PROMPT,
    tools: [webSearchTool(6)],
    messages: [{ role: 'user', content: buildDraftPrompt(cluster, today) }],
  })

  const draft = parseStageResponse(content, stopReason, 'Draft')
  const sources = collectSearchSources(content)
  console.log(`   Draft written: "${draft.headline}" (${sources.length} source(s) consulted)`)
  return { ...draft, researchSources: sources }
}

async function reviseWithCritique(draft, critique, { date } = {}) {
  const today = date || new Date().toISOString().split('T')[0]
  console.log(`   Revising article based on fact-check critique...`)

  const { content, stopReason } = await createWithTools({
    model: MODEL,
    thinking: { type: 'adaptive' },
    output_config: { effort: WRITE_EFFORT },
    system: SYSTEM_PROMPT,
    tools: [webSearchTool(6)],
    messages: [{ role: 'user', content: buildRevisionPrompt(draft, critique, today) }],
  })

  const revised = parseStageResponse(content, stopReason, 'Revision')
  const sources = [...new Set([...(draft.researchSources ?? []), ...collectSearchSources(content)])]
  console.log(`   Revised: "${revised.headline}"`)
  return { ...revised, researchSources: sources }
}

module.exports = { writeDraft, reviseWithCritique }
