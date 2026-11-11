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

const { longestCommonRun } = require('./gate')

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

  if (best && best.score >= MATCH_THRESHOLD) return best
  return locateContained(sentences, excerpt)
}

/** How much of a part-sentence excerpt has to run unbroken through the text. */
const CONTAINED_RUN = 0.8

/** Below this many words an excerpt has to match exactly, and only once. */
const SHORT_EXCERPT = 6

/** Every word in order, stopwords included - a run is about position. */
function orderedWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Locate an excerpt that is only part of a sentence.
 *
 * The matcher above scores a window of whole sentences against the excerpt in
 * both directions, on purpose: coverage alone would let three words swallow a
 * paragraph. The cost of that is that a reviewer who quotes a clause - "a
 * former Wayne County public health director", out of a thirty-word sentence -
 * can never be matched, because the sentence is mostly not the clause.
 *
 * That was not a corner case. Over the editions of 2026-11-01 to 11-04 the
 * first correction pass reported 82 passages it could not find, and reviewers
 * quote clauses constantly. A passage that cannot be found cannot be cut, so it
 * reaches the gate intact, where the only outcomes left are the two blockers
 * for text that is still there: UNSUPPORTED_WAIVER and FALSE_DISPOSITION. The
 * first gate raised those 45 times across those editions and 17 of 41 drafts
 * were discarded. How many of the 45 began as an unfound passage the logs
 * cannot say - they cut excerpts at 80 characters - but the ones that can be
 * read in full ("a former Wayne County public health director", "kitchen-table
 * issue") are clauses.
 *
 * So when the sentence-sized match fails, look for the excerpt's words running
 * unbroken inside one sentence, or straddling two. Contiguity is what keeps
 * this from being the bag-of-words match the comment above warns about: the
 * words have to appear together and in order, not merely somewhere nearby.
 *
 * The edit still happens to the whole sentence - a deletion removes it and a
 * replacement stands in for it. Cutting a clause out of the middle of a
 * sentence by string surgery would leave grammar to chance.
 */
function locateContained(sentences, excerpt) {
  const wanted = orderedWords(excerpt)
  if (wanted.length < 3) return null // two words turn up everywhere

  const short = wanted.length < SHORT_EXCERPT
  const need = short ? 1 : CONTAINED_RUN
  const sentenceWords = sentences.map(orderedWords)

  for (const span of [1, 2]) {
    const hits = []
    for (let start = 0; start + span <= sentences.length; start++) {
      const window = sentenceWords.slice(start, start + span).flat()
      const score = longestCommonRun(wanted, window) / wanted.length
      if (score >= need) hits.push({ start, end: start + span, score, contained: true })
    }
    if (hits.length === 0) continue
    // A short phrase found in two different places is not an address. Better
    // to report it unfound than to cut the wrong sentence.
    if (short && span === 1 && hits.length > 1) return null
    return hits.reduce((a, b) => (b.score > a.score ? b : a))
  }

  return null
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

/** Strip scheme, `www.` and any trailing slash so two spellings of a URL match. */
function canonicalizeUrl(url) {
  return String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/**
 * A rewrite has to come with a source, or it becomes a deletion.
 *
 * On 2026-10-26 the correction step chose `replace` 62 times and `delete` 7.
 * Every rewrite is a new sentence the article did not have, which the next
 * review round reads as a new claim, which the validator then waives without
 * evidence - UNSUPPORTED_WAIVER went to 44 that day while one article
 * published. The pipeline was manufacturing its own blockers, and paying
 * 100-200k tokens a call to do it.
 *
 * Telling the model to prefer deletion did not work; the prompt already said
 * an article is better short than wrong. So the rule is enforced instead: a
 * replacement must cite a URL this step actually retrieved, and one that does
 * not is downgraded to a deletion. Nothing new enters the article without a
 * source behind it, and the model's reluctance to cut stops being decisive.
 */
function enforceSourcedReplacements(resolutions = [], retrievedUrls = []) {
  const retrieved = new Set(retrievedUrls.map(canonicalizeUrl).filter(Boolean))
  const downgraded = []

  const enforced = resolutions.map(r => {
    if (r?.action !== 'replace') return r
    const cited = (String(r.reference ?? '').match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])
      .some(u => retrieved.has(canonicalizeUrl(u)))
    if (cited) return r
    downgraded.push(r.excerpt)
    return { ...r, action: 'delete' }
  })

  return { resolutions: enforced, downgraded }
}

/**
 * A contradicted claim cannot be kept, whatever the correction step preferred.
 *
 * "Keep" means the passage is right as it stands. For a claim the fact-check
 * has just shown to be wrong, with the page open that says so, that is not an
 * available answer - the gate will not waive it, so honouring the keep only
 * spends a validation finding that out. The choice here is the one the gate
 * would have forced anyway: put it right from the sources, or cut it.
 */
function refuseToKeepContradicted(resolutions = [], issues = []) {
  const contradicted = issues
    .filter(i => i?.type === 'CONTRADICTED')
    .map(i => significantWords(i.excerpt))
  const overruled = []

  const enforced = resolutions.map(r => {
    if (r?.action !== 'keep') return r
    const words = significantWords(r.excerpt)
    if (!contradicted.some(c => matchScore(c, words) >= 0.8)) return r
    overruled.push(r.excerpt)
    return { ...r, action: 'delete' }
  })

  return { resolutions: enforced, overruled }
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
  enforceSourcedReplacements,
  refuseToKeepContradicted,
  locateContained,
  canonicalizeUrl,
  pruneKeyFacts,
  locateExcerpt,
  splitSentences,
  splitParagraphs,
  matchScore,
  MATCH_THRESHOLD,
}
