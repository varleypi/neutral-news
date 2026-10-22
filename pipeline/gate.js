/**
 * The publication gate — the part of the quality check that is code, not prose.
 *
 * Background: on 2026-10-19 the pipeline published "SpaceX is privately held;
 * shares do not trade on public markets" as a key fact, four months after the
 * company listed on Nasdaq as SPCX. Grok's fact-check flagged the exact sentence
 * at `required` severity. The final validator read that flag, called the claim
 * "widely corroborated public facts" on the strength of its own training data,
 * and approved the article at 8.8 confidence. Four of that day's five stories
 * had required corrections waived the same way.
 *
 * The lesson is not that the validator reasoned badly — it reasoned exactly as
 * its prompt told it to. The lesson is that a waiver decided in free text, by a
 * model whose memory is the thing under suspicion, is not a gate. So the final
 * say now lives here:
 *
 *   1. A claim the verification stage found CONTRADICTED by current sources
 *      blocks publication outright. Nothing can waive it.
 *   2. Every `required` issue must be *resolved*, not argued away — either the
 *      flagged text is gone from the article, or the validator names external
 *      evidence (a reference entry, or a URL the verifier actually retrieved)
 *      that supports it. "Well known" is not evidence.
 *   3. A disposition that claims text was removed while the text is still in
 *      the article is itself a blocker. The gate checks the article, not the
 *      claim about the article.
 *
 * Everything here is pure and synchronous so it can be tested without API calls.
 */

// Words too common to carry meaning when comparing two passages.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'that',
  'this', 'it', 'its', 'has', 'have', 'had', 'not', 'no', 'they', 'their',
])

/** Lowercase, strip punctuation, collapse whitespace — for text comparison. */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(text) {
  const n = normalize(text)
  return n ? n.split(' ') : []
}

/**
 * Longest run of consecutive words shared by two token lists.
 *
 * A revision that genuinely addresses a flagged passage rewrites or deletes it.
 * One that only trims a clause leaves most of the original wording contiguous,
 * which is what this measures — unlike a bag-of-words score, which a reshuffle
 * would defeat.
 */
function longestCommonRun(a, b) {
  if (a.length === 0 || b.length === 0) return 0
  let best = 0
  // Rolling two-row DP: prev[j] is the run length ending at a[i-1] / b[j-1].
  let prev = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
        if (curr[j] > best) best = curr[j]
      }
    }
    prev = curr
  }
  return best
}

/**
 * Is the flagged excerpt still substantially present in the article?
 *
 * Exact containment is the common case. The run check catches the revision that
 * shaved a few words off the end and left the assertion standing — which is
 * precisely what happened to the SpaceX sentence.
 */
function excerptStillPresent(excerpt, body, threshold = 0.6) {
  const e = normalize(excerpt)
  const b = normalize(body)
  if (!e) return false
  if (b.includes(e)) return true

  const ew = e.split(' ')
  if (ew.length < 4) return false // too short to judge by overlap
  return longestCommonRun(ew, b.split(' ')) / ew.length >= threshold
}

/** Fraction of `candidate`'s significant words that also appear in `target`. */
function significantOverlap(candidate, target) {
  const c = words(candidate).filter(w => !STOPWORDS.has(w))
  if (c.length === 0) return 0
  const t = new Set(words(target).filter(w => !STOPWORDS.has(w)))
  return c.filter(w => t.has(w)).length / c.length
}

function extractUrls(text) {
  return String(text ?? '').match(/https?:\/\/[^\s<>"')\]]+/g) ?? []
}

/** Strip scheme, `www.`, and any trailing slash so two spellings of one URL match. */
function canonicalizeUrl(url) {
  return String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/**
 * Does this disposition point at evidence outside the model's own memory?
 *
 * This is the check the 10/19 waiver would have failed. "The founding year and
 * private status are widely corroborated public facts" names no reference and
 * no retrieved source, so it buys the claim nothing.
 */
function evidenceIsExternal(disposition, { references = [], verificationSources = [] }) {
  const ref = String(disposition?.evidenceRef ?? '').trim()
  if (!ref) return false

  if (disposition.evidenceType === 'verification') {
    const cited = new Set(verificationSources.map(canonicalizeUrl).filter(Boolean))
    return extractUrls(ref).some(u => cited.has(canonicalizeUrl(u)))
  }

  if (disposition.evidenceType === 'reference') {
    // The validator should quote the reference entry it is leaning on; accept a
    // paraphrase, but it has to be recognisably one of the listed references.
    return references.some(r => significantOverlap(ref, r) >= 0.6)
  }

  return false
}

/**
 * Decide whether an article may be published.
 *
 * Returns `{ passed, blockers }`. `blockers` is the full list, not the first
 * failure, so a rejection can be logged and acted on in one pass.
 */
function evaluateGate({ article, review, validation, verification }) {
  const blockers = []
  const body = `${article?.headline ?? ''}\n${article?.summary ?? ''}\n${article?.body ?? ''}\n${(article?.keyFacts ?? []).join('\n')}`
  const references = article?.references ?? []

  // ── 1. Contradicted claims are absolute ───────────────────────────────────
  // A claim current sources say is false does not get published behind a
  // confidence score, however well the rest of the article reads.
  const contradicted = (verification?.claims ?? []).filter(c => c.verdict === 'CONTRADICTED')
  for (const c of contradicted) {
    blockers.push({
      kind: 'CONTRADICTED_CLAIM',
      detail: `Current sources contradict: "${c.claim}"`,
      evidence: c.evidence ?? '',
      sources: c.sources ?? [],
    })
  }

  // The verifier failing is not the same as the verifier passing. If it could
  // not run we have no stale-fact check at all, so the article waits.
  if (verification?.status && verification.status !== 'ok') {
    blockers.push({
      kind: 'VERIFICATION_UNAVAILABLE',
      detail: `Claim verification did not complete (${verification.status}): ${verification.error ?? 'no detail'}`,
    })
  }

  // ── 2. Required issues must be resolved, not waived ───────────────────────
  const verificationSources = (verification?.claims ?? []).flatMap(c => c.sources ?? [])
  const dispositions = validation?.requiredIssueDispositions ?? []
  const required = (review?.issues ?? []).filter(i => i.severity === 'required')

  for (const issue of required) {
    const present = excerptStillPresent(issue.excerpt, body)

    // Pair the disposition to its issue by excerpt — the validator echoes the
    // excerpt back, and matching on it stops a disposition for one issue being
    // credited to another.
    const d = dispositions.find(x => significantOverlap(x.excerpt, issue.excerpt) >= 0.6)

    if (!d) {
      if (!present) continue // silently fixed by the rewrite; nothing to answer for
      blockers.push({
        kind: 'UNANSWERED_REQUIRED_ISSUE',
        detail: `Required ${issue.type} issue was neither removed nor addressed: "${issue.excerpt}"`,
      })
      continue
    }

    if (d.disposition === 'removed' || d.disposition === 'corrected') {
      // Trust, but check the article rather than the claim about it.
      if (present) {
        blockers.push({
          kind: 'FALSE_DISPOSITION',
          detail: `Validation reported this as "${d.disposition}", but the text is still in the article: "${issue.excerpt}"`,
        })
      }
      continue
    }

    if (d.disposition === 'supported') {
      if (!evidenceIsExternal(d, { references, verificationSources })) {
        blockers.push({
          kind: 'UNSUPPORTED_WAIVER',
          detail: `Required ${issue.type} issue was kept as "supported" without external evidence: "${issue.excerpt}"`,
          offeredEvidence: d.evidenceRef ?? '',
        })
      }
      continue
    }

    blockers.push({
      kind: 'INVALID_DISPOSITION',
      detail: `Unrecognised disposition "${d.disposition}" for required issue: "${issue.excerpt}"`,
    })
  }

  // ── 3. The validator still has to approve ─────────────────────────────────
  // It can no longer wave an article through on its own, but it can still stop
  // one — the gate removes its veto over the fact-check, not its own veto.
  if (validation?.approved !== true) {
    blockers.push({
      kind: 'VALIDATION_NOT_APPROVED',
      detail: validation?.validationNotes || 'Final validation did not approve the article',
    })
  }

  return { passed: blockers.length === 0, blockers }
}

/** One-line-per-blocker summary for the run log. */
function describeBlockers(blockers) {
  return blockers.map(b => `[${b.kind}] ${b.detail}`)
}

module.exports = {
  evaluateGate,
  describeBlockers,
  excerptStillPresent,
  evidenceIsExternal,
  significantOverlap,
  normalize,
}
