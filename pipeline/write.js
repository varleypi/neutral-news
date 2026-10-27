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
  complete,
  completeWithSearch,
  parseSearchResponse,
  WRITER_MODEL,
  ARTICLE_SCHEMA,
  CORRECTIONS_SCHEMA,
} = require('./claude')
const { applyResolutions, pruneKeyFacts, supersededExcerpts, enforceSourcedReplacements } = require('./corrections')

// Drafting and revision are writing tasks, not reasoning tasks: the research is
// done by search, not by thinking harder. Medium effort keeps them from
// dominating the run's wall-clock, which in the first pilot they did.
const WRITE_EFFORT = process.env.CLAUDE_WRITE_EFFORT || 'medium'

// Corrections are precision work on specific sentences, not composition, and
// getting them wrong costs a whole candidate. Worth more effort than drafting.
const CORRECT_EFFORT = process.env.CLAUDE_CORRECT_EFFORT || 'high'

// Set WRITER_SEARCH=off to fall back to master's non-searching writer - the
// cheaper shape, at the cost of the stage that was inventing background.
const WRITER_SEARCHES = process.env.WRITER_SEARCH !== 'off'

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

async function writeDraft(cluster, { date } = {}) {
  const today = date || new Date().toISOString().split('T')[0]
  console.log(`   Writing draft for: "${cluster.topicLabel}"`)

  if (!WRITER_SEARCHES) {
    const text = await complete({ system: SYSTEM_PROMPT, prompt: buildDraftPrompt(cluster, today), maxTokens: 3000, schema: ARTICLE_SCHEMA, stage: 'draft' })
    const draft = JSON.parse(text)
    console.log(`   Draft written: "${draft.headline}"`)
    return draft
  }

  const { content, stopReason, sources } = await completeWithSearch({
    model: WRITER_MODEL,
    system: SYSTEM_PROMPT,
    prompt: buildDraftPrompt(cluster, today),
    maxUses: 6,
    effort: WRITE_EFFORT,
    schema: ARTICLE_SCHEMA,
    stage: 'draft',
  })

  const draft = parseSearchResponse(content, stopReason, 'Draft')
  console.log(`   Draft written: "${draft.headline}" (${sources.length} source(s) consulted)`)
  return { ...draft, researchSources: sources }
}

/**
 * Apply the required corrections - by deciding, not by rewriting.
 *
 * The model is asked for one resolution per flagged passage and nothing else.
 * It never sees an instruction to "return the revised article", because that
 * is the instruction it answered by returning the original: on 2026-10-24 the
 * writer was handed four required corrections, sent back the article verbatim,
 * was shown the exact passages that had not moved, and sent it back verbatim
 * again. Twelve candidates, one published.
 *
 * ./corrections.js performs the edits, so a passage marked for deletion is
 * gone whatever the model would have preferred, and a resolution that does not
 * match any sentence is reported here rather than discovered by the validator
 * three paid stages downstream.
 */
async function applyCorrections(article, requiredIssues, { date } = {}) {
  const today = date || new Date().toISOString().split('T')[0]
  if (requiredIssues.length === 0) return { article, applied: [], unresolved: [] }

  console.log(`   Applying ${requiredIssues.length} required correction(s)...`)

  const issueList = requiredIssues
    .map((i, n) => `${n + 1}. [${i.type}] "${i.excerpt}"\n   why it was flagged: ${i.correction}`)
    .join('\n\n')

  const prompt = `Today's date is ${today}. A fact-checker has flagged passages in this article.
Decide what happens to each one. You are NOT rewriting the article - you are issuing one
instruction per passage, and those instructions will be applied to the text mechanically.

ARTICLE BODY:
${article.body}

REFERENCES currently cited:
${(article.references ?? []).map((r, n) => `[R${n + 1}] ${r}`).join('\n') || 'None'}

FLAGGED PASSAGES:
${issueList}

For each flagged passage choose exactly one action:

  "delete"  - cut it. Choose this whenever you cannot source the claim. An article is
              better short than wrong, and a deleted sentence costs nothing; an unsourced
              one costs the whole story.
  "replace" - the claim is salvageable if restated accurately. Put the corrected sentence
              in "replacement", and the URL you confirmed it against in "reference".
              THE URL IS REQUIRED and must be a page you actually opened in this search.
              A replacement without one is downgraded to a deletion automatically, so
              leaving it out does not keep the sentence - it only loses you the chance to
              write a better one. Write a complete sentence in the article's voice: it is
              dropped in where the old one was, so it has to read naturally beside its
              neighbours.
  "keep"    - the passage is right as it stands AND you can name a source. Put the source
              in "reference", as an outlet plus what it supports. Only use this when you
              have actually confirmed it; your own confidence is not a source, and a "keep"
              without real backing fails the article later just as surely as leaving the
              passage alone would.

Copy each "excerpt" back exactly as it appears in the FLAGGED PASSAGES list, so the right
sentence is found. Give one resolution per flagged passage - all ${requiredIssues.length} of them.

Searching is available; use it for any "replace" or "keep".`

  const { content, stopReason, sources } = await completeWithSearch({
    model: WRITER_MODEL,
    system: SYSTEM_PROMPT,
    prompt,
    maxUses: 8,
    effort: CORRECT_EFFORT,
    schema: CORRECTIONS_SCHEMA,
    stage: 'corrections',
  })

  const { resolutions: proposed = [] } = parseSearchResponse(content, stopReason, 'Corrections')

  // Nothing new enters the article without a source behind it. A rewrite that
  // cannot cite a page this step actually opened becomes a deletion.
  const { resolutions, downgraded } = enforceSourcedReplacements(proposed, sources)
  if (downgraded.length > 0) {
    console.log(`   ${downgraded.length} unsourced rewrite(s) downgraded to deletions`)
  }

  // The model's instructions; our edits.
  const { body, applied } = applyResolutions(article.body, resolutions.filter(r => r.action !== 'keep'))
  // A replacement supersedes the original claim just as a deletion does, so a
  // key fact restating either has to go. Pruning only on deletions left the
  // probe with a corrected body beside an uncorrected key fact.
  const superseded = supersededExcerpts(applied)
  const addedRefs = resolutions
    .filter(r => r.action === 'keep' && String(r.reference ?? '').trim())
    .map(r => r.reference.trim())

  const corrected = {
    ...article,
    body,
    keyFacts: pruneKeyFacts(article.keyFacts ?? [], superseded),
    references: [...new Set([...(article.references ?? []), ...addedRefs])],
  }

  // A flagged passage with no resolution, or one whose resolution did not
  // match any sentence, is still in the article. Say so now - it is free.
  const resolvedExcerpts = new Set(applied.filter(a => a.ok).map(a => a.excerpt))
  const kept = new Set(resolutions.filter(r => r.action === 'keep').map(r => r.excerpt))
  const unresolved = requiredIssues.filter(i =>
    !resolvedExcerpts.has(i.excerpt) && !kept.has(i.excerpt) &&
    !applied.some(a => a.ok && a.excerpt === i.excerpt)
  )

  const counts = resolutions.reduce((acc, r) => ({ ...acc, [r.action]: (acc[r.action] ?? 0) + 1 }), {})
  console.log(
    `   Corrections: ${counts.delete ?? 0} deleted, ${counts.replace ?? 0} replaced, ${counts.keep ?? 0} kept with a source` +
    (applied.some(a => !a.ok) ? ` - ${applied.filter(a => !a.ok).length} could not be located` : '')
  )
  for (const a of applied.filter(a => !a.ok)) console.log(`     ! ${a.reason}: "${String(a.excerpt).slice(0, 80)}"`)

  return { article: corrected, applied, unresolved }
}

module.exports = { writeDraft, applyCorrections }
