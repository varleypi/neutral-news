/**
 * Applying required corrections to an article — in code, not by asking nicely.
 *
 * The 2026-10-24 edition published one new story out of twelve candidates. The
 * gate was not the problem; the writer was. Over and over the validator
 * reported the same thing: "None of the four REQUIRED fixes were applied; all
 * flagged passages remain verbatim in the article." The pipeline asked for a
 * revision, got the original back, asked again naming the exact passages that
 * had not moved, and got the original back a second time.
 *
 * Asking a third time was not going to work. The flaw is in the shape of the
 * request: "here is your article and a list of problems, now return the whole
 * article again" invites copying, and nothing about the reply makes copying
 * detectable until three paid stages later.
 *
 * So the correction step no longer asks for an article. It asks for one
 * resolution per flagged passage — delete it, or replace it with this text —
 * and the editing happens here. A passage cannot survive a deletion that code
 * performs, and a resolution that fails to match is reported as a failure
 * immediately and for free, rather than discovered by a validator later.
 *
 * Matching is at sentence level on purpose. A flagged excerpt is quoted back by
 * a model and rarely matches the body byte for byte — a smart quote, a trimmed
 * clause, an ellipsis in the middle. Sentences are the smallest unit that
 * survives that kind of drift and still edits cleanly.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'that',
  'this', 'it', 'its', 'has', 'have', 'had', 'not', 'no', 'they', 'their',
])

/** How much of a sentence window has to look like the excerpt to count as it. */
const MATCH_THRESHOLD = 0.5

/** The most sentences one flagged excerpt is allowed to span. */
const MAX_WINDOW = 6

function significantWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
}

/** Paragraphs, then sentences within each — so rebuilding keeps the shape. */
function splitParagraphs(body) {
  return String(body ?? '').split(/\n{2,}/)
}

function splitSentences(paragraph) {
  return String(paragraph ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0)
}

/**
 * How well a candidate span of text stands in for the excerpt.
 *
 * Both directions matter. Coverage alone would let a short excerpt swallow a
 * whole paragraph, because every one of its words appears somewhere in there;
 * precision alone would match a long window to a fragment. The harmonic mean
 * of the two keeps the span roughly the size of the thing being matched.
 */
function matchScore(excerptWords, candidateWords) {
  if (excerptWords.length === 0 || candidateWords.length === 0) return 0
  const candSet = new Set(candidateWords)
  const excSet = new Set(excerptWords)
  const coverage = excerptWords.filter(w => candSet.has(w)).length / excerptWords.length
  const precision = candidateWords.filter(w => excSet.has(w)).length / candidateWords.length
  if (coverage === 0 || precision === 0) return 0
  return (2 * coverage * precision) / (coverage + precision)
}

/**
 * Locate the flagged excerpt as a run of consecutive sentences.
 *
 * Returns `{ start, end, score }` indices into the flat sentence list, or null
 * when nothing resembles it closely enough — which is a real answer, not a
 * failure to try. A model that quotes an excerpt the article does not contain
 * has told us something worth knowing.
 */
function locateExcerpt(sentences, excerpt) {
  const excerptWords = significantWords(excerpt)
  if (excerptWords.length === 0) return null

  const sentenceWords = sentences.map(significantWords)
  let best = null

  for (let start = 0; start < sentences.length; start++) {
    let windowWords = []
    for (let span = 1; span <= MAX_WINDOW && start + span <= sentences.length; span++) {
      windowWords = windowWords.concat(sentenceWords[start + span - 1])
      const score = matchScore(excerptWords, windowWords)
      if (!best || score > best.score) best = { start, end: start + span, score }
    }
  }

  return best && best.score >= MATCH_THRESHOLD ? best : null
}

/**
 * Apply one resolution per flagged passage, and report exactly what happened.
 *
 * `resolutions` are `{ excerpt, action: 'delete' | 'replace', replacement }`.
 * Nothing here trusts the model's account of its own work: every resolution
 * either changed the text or is reported as not applied.
 */
function applyResolutions(body, resolutions = []) {
  const paragraphs = splitParagraphs(body)

  // Flatten to sentences, remembering which paragraph each came from, so the
  // paragraph breaks survive an edit that removes a whole sentence.
  const flat = []
  paragraphs.forEach((p, pIndex) => {
    for (const sentence of splitSentences(p)) flat.push({ sentence, pIndex, removed: false })
  })

  const applied = []

  for (const res of resolutions) {
    const excerpt = res?.excerpt ?? ''
    const live = flat.filter(s => !s.removed)
    const hit = locateExcerpt(live.map(s => s.sentence), excerpt)

    if (!hit) {
      applied.push({
        excerpt,
        action: res?.action,
        ok: false,
        reason: 'the flagged passage could not be found in the article',
      })
      continue
    }

    const targets = live.slice(hit.start, hit.end)

    if (res.action === 'delete') {
      targets.forEach(t => { t.removed = true })
      applied.push({ excerpt, action: 'delete', ok: true, score: hit.score, sentences: targets.length })
      continue
    }

    if (res.action === 'replace') {
      const replacement = String(res.replacement ?? '').trim()
      if (!replacement) {
        applied.push({ excerpt, action: 'replace', ok: false, reason: 'replace with no replacement text' })
        continue
      }
      // The replacement takes the first sentence's slot; the rest go away, so a
      // multi-sentence passage collapses to the corrected text.
      targets[0].sentence = replacement
      targets.slice(1).forEach(t => { t.removed = true })
      applied.push({ excerpt, action: 'replace', ok: true, score: hit.score, sentences: targets.length })
      continue
    }

    applied.push({ excerpt, action: res?.action, ok: false, reason: `unrecognised action "${res?.action}"` })
  }

  // Rebuild, dropping paragraphs that lost all their sentences.
  const rebuilt = paragraphs
    .map((_, pIndex) =>
      flat.filter(s => s.pIndex === pIndex && !s.removed).map(s => s.sentence.trim()).join(' ').trim()
    )
    .filter(p => p.length > 0)
    .join('\n\n')

  return { body: rebuilt, applied }
}

/**
 * Drop key facts that restate a passage being removed.
 *
 * The 10/19 article carried "SpaceX is privately held" twice — once in the body
 * and once promoted into keyFacts. Editing only the body would have left the
 * false claim on the page in the more prominent of the two places.
 */
function pruneKeyFacts(keyFacts = [], removedExcerpts = []) {
  if (removedExcerpts.length === 0) return keyFacts
  const removedWordSets = removedExcerpts.map(significantWords)
  return keyFacts.filter(fact => {
    const factWords = significantWords(fact)
    return !removedWordSets.some(rw => matchScore(factWords, rw) >= MATCH_THRESHOLD)
  })
}

/**
 * Excerpts whose claim no longer stands, taken from what actually applied.
 *
 * Both a deletion and a replacement supersede the original claim, and key
 * facts restating either must go with it. Getting this wrong is how the
 * correction step shipped a corrected body beside an uncorrected key fact -
 * the same two-places failure as the article that started all this, where
 * "SpaceX is privately held" appeared in the body and again in keyFacts.
 *
 * Driven by the applied report rather than the requested resolutions, so a
 * resolution that failed to match cannot prune anything.
 */
function supersededExcerpts(applied = []) {
  return applied
    .filter(a => a.ok && (a.action === 'delete' || a.action === 'replace'))
    .map(a => a.excerpt)
}

module.exports = {
  applyResolutions,
  supersededExcerpts,
  pruneKeyFacts,
  locateExcerpt,
  splitSentences,
  splitParagraphs,
  matchScore,
  MATCH_THRESHOLD,
}
