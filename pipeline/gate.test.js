/**
 * Tests for the publication gate.
 *
 * Run with: npm test
 *
 * The central fixture is the article that prompted the gate: "Musk Says He Will
 * Give Every American Child One Share of SpaceX", published 2026-10-19 with the
 * key fact "SpaceX is privately held; shares do not trade on public markets" —
 * four months after SpaceX listed on Nasdaq as SPCX. The text below is the
 * article's real wording, and the review issue and validation note are the ones
 * actually stored for it in neutral_articles.
 *
 * The first test is the regression test: that exact combination of inputs must
 * not produce a publishable article.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const {
  evaluateGate,
  excerptStillPresent,
  evidenceIsExternal,
  significantOverlap,
} = require('./gate')

// ── The 10/19 SpaceX article, as published ───────────────────────────────────

const SPACEX_EXCERPT =
  'SpaceX, which he founded in 2002, remains privately held, meaning its shares do not ' +
  'trade on public markets and have historically been held by employees, early investors, ' +
  'and institutional backers.'

const SPACEX_ARTICLE = {
  headline: 'Musk Says He Will Give Every American Child One Share of SpaceX',
  summary: 'Elon Musk said he will give one of his SpaceX shares to every child in America next year.',
  body:
    'Elon Musk said Sunday that he intends to give one of his SpaceX shares to every child ' +
    'in America, a pledge he described as the first of many.\n\n' +
    SPACEX_EXCERPT + '\n\n' +
    'As of now, the pledge exists only as a public statement from Musk. SpaceX has not ' +
    'issued a separate corporate announcement outlining a formal program, and no regulatory ' +
    'filings describing such a distribution have been reported.',
  keyFacts: [
    'Musk said he will give one SpaceX share to each child in the US.',
    'SpaceX is privately held; shares do not trade on public markets.',
  ],
  references: [
    "MarketWatch — covered the pledge and its possible impact on institutional shareholders",
    "Other news outlet headlines reporting Musk's statement",
  ],
}

const SPACEX_REVIEW = {
  overallScore: 7,
  issues: [
    {
      type: 'UNVERIFIABLE',
      severity: 'required',
      excerpt: SPACEX_EXCERPT,
      correction: 'Remove or attribute all details not present in source headlines, including founding year and historical ownership structure.',
    },
  ],
}

// The waiver the validator actually wrote, in the structured form it must now use.
const MEMORY_WAIVER = {
  excerpt: SPACEX_EXCERPT,
  disposition: 'supported',
  evidenceType: 'none',
  evidenceRef: '',
  note: 'The founding year and private status are widely corroborated public facts.',
}

const APPROVED = {
  approved: true,
  confidenceScore: 8.8,
  neutralityRating: 'Excellent',
  requiredIssueDispositions: [MEMORY_WAIVER],
  validationNotes: 'Approved.',
}

const CLEAN_VERIFICATION = { status: 'ok', claims: [] }

test('the 10/19 SpaceX article does not publish, even with the validator approving', () => {
  const { passed, blockers } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: SPACEX_REVIEW,
    validation: APPROVED,
    verification: CLEAN_VERIFICATION,
  })

  assert.equal(passed, false)
  assert.ok(
    blockers.some(b => b.kind === 'UNSUPPORTED_WAIVER'),
    `expected an UNSUPPORTED_WAIVER blocker, got ${JSON.stringify(blockers)}`
  )
})

test('a contradicted claim blocks publication and cannot be waived', () => {
  const verification = {
    status: 'ok',
    claims: [{
      claim: 'SpaceX is privately held and its shares do not trade publicly',
      excerpt: SPACEX_EXCERPT,
      verdict: 'CONTRADICTED',
      evidence: 'SpaceX listed on Nasdaq as SPCX on 2026-06-12.',
      sources: ['https://ir.spacex.com/updates/releases-details/2026/'],
    }],
  }

  // Even with the issue properly removed and the validator approving, a
  // contradicted claim stands on its own.
  const { passed, blockers } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: { issues: [] },
    validation: { approved: true, requiredIssueDispositions: [] },
    verification,
  })

  assert.equal(passed, false)
  assert.equal(blockers.filter(b => b.kind === 'CONTRADICTED_CLAIM').length, 1)
})

test('a waiver citing a retrieved source is accepted', () => {
  const verification = {
    status: 'ok',
    claims: [{
      claim: 'Musk founded SpaceX in 2002',
      excerpt: SPACEX_EXCERPT,
      verdict: 'SUPPORTED',
      evidence: 'Confirmed.',
      sources: ['https://www.spacex.com/about'],
    }],
  }

  const { passed } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: SPACEX_REVIEW,
    validation: {
      approved: true,
      requiredIssueDispositions: [{
        excerpt: SPACEX_EXCERPT,
        disposition: 'supported',
        evidenceType: 'verification',
        evidenceRef: 'https://www.spacex.com/about',
        note: 'Confirmed against the company site.',
      }],
    },
    verification,
  })

  assert.equal(passed, true)
})

test('a waiver citing a source the verifier never retrieved is rejected', () => {
  const { passed, blockers } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: SPACEX_REVIEW,
    validation: {
      approved: true,
      requiredIssueDispositions: [{
        excerpt: SPACEX_EXCERPT,
        disposition: 'supported',
        evidenceType: 'verification',
        // Plausible, and never actually fetched.
        evidenceRef: 'https://en.wikipedia.org/wiki/SpaceX',
        note: 'Public record.',
      }],
    },
    verification: { status: 'ok', claims: [{ verdict: 'SUPPORTED', sources: ['https://www.spacex.com/about'] }] },
  })

  assert.equal(passed, false)
  assert.ok(blockers.some(b => b.kind === 'UNSUPPORTED_WAIVER'))
})

test('a waiver citing a listed reference is accepted', () => {
  const { passed } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: {
      issues: [{
        type: 'UNVERIFIABLE',
        severity: 'required',
        excerpt: 'possible impact on institutional shareholders, including endowments',
        correction: 'Attribute it.',
      }],
    },
    validation: {
      approved: true,
      requiredIssueDispositions: [{
        excerpt: 'possible impact on institutional shareholders, including endowments',
        disposition: 'supported',
        evidenceType: 'reference',
        evidenceRef: 'MarketWatch — covered the pledge and its impact on institutional shareholders, including endowments',
        note: 'Backed by the MarketWatch reference.',
      }],
    },
    verification: CLEAN_VERIFICATION,
  })

  assert.equal(passed, true)
})

test('claiming text was removed while it is still in the article is a blocker', () => {
  const { passed, blockers } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: SPACEX_REVIEW,
    validation: {
      approved: true,
      requiredIssueDispositions: [{
        excerpt: SPACEX_EXCERPT,
        disposition: 'removed',
        evidenceType: 'none',
        evidenceRef: '',
        note: 'Cut from the body.',
      }],
    },
    verification: CLEAN_VERIFICATION,
  })

  assert.equal(passed, false)
  assert.ok(blockers.some(b => b.kind === 'FALSE_DISPOSITION'))
})

test('a required issue genuinely removed needs no disposition', () => {
  const rewritten = {
    ...SPACEX_ARTICLE,
    body: 'Elon Musk said Sunday that he intends to give one of his SpaceX shares to every child in America.',
    keyFacts: ['Musk said he will give one SpaceX share to each child in the US.'],
  }

  const { passed } = evaluateGate({
    article: rewritten,
    review: SPACEX_REVIEW,
    validation: { approved: true, requiredIssueDispositions: [] },
    verification: CLEAN_VERIFICATION,
  })

  assert.equal(passed, true)
})

test('an unanswered required issue blocks', () => {
  const { passed, blockers } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: SPACEX_REVIEW,
    validation: { approved: true, requiredIssueDispositions: [] },
    verification: CLEAN_VERIFICATION,
  })

  assert.equal(passed, false)
  assert.ok(blockers.some(b => b.kind === 'UNANSWERED_REQUIRED_ISSUE'))
})

test('verification failing to run is itself a blocker', () => {
  const { passed, blockers } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: { issues: [] },
    validation: { approved: true, requiredIssueDispositions: [] },
    verification: { status: 'failed', error: 'xAI API 503', claims: [] },
  })

  assert.equal(passed, false)
  assert.ok(blockers.some(b => b.kind === 'VERIFICATION_UNAVAILABLE'))
})

test('a clean article passes', () => {
  const { passed, blockers } = evaluateGate({
    article: {
      headline: 'Supreme Court to Review Federal Ban on Home Distilling',
      summary: 'The court agreed to hear a constitutional challenge.',
      body: 'The Supreme Court agreed on Monday to hear a challenge to the federal ban on distilling spirits at home.',
      keyFacts: ['The court granted certiorari.'],
      references: ['Associated Press — reported the cert grant'],
    },
    review: { issues: [{ type: 'BIASED', severity: 'suggested', excerpt: 'anything', correction: 'optional' }] },
    validation: { approved: true, requiredIssueDispositions: [] },
    verification: {
      status: 'ok',
      claims: [{ claim: 'Cert was granted', verdict: 'SUPPORTED', sources: ['https://apnews.com/x'] }],
    },
  })

  assert.deepEqual(blockers, [])
  assert.equal(passed, true)
})

test('the validator can still stop an article on its own', () => {
  const { passed, blockers } = evaluateGate({
    article: SPACEX_ARTICLE,
    review: { issues: [] },
    validation: { approved: false, requiredIssueDispositions: [], validationNotes: 'Headline is sensational.' },
    verification: CLEAN_VERIFICATION,
  })

  assert.equal(passed, false)
  assert.ok(blockers.some(b => b.kind === 'VALIDATION_NOT_APPROVED'))
})

// ── The text-matching primitives ─────────────────────────────────────────────

test('excerptStillPresent sees through a trimmed clause', () => {
  // The revision drops the trailing clause but keeps the false assertion.
  const trimmed = 'SpaceX, which he founded in 2002, remains privately held, meaning its shares do not trade on public markets.'
  assert.equal(excerptStillPresent(SPACEX_EXCERPT, trimmed), true)
})

test('excerptStillPresent reports a genuine rewrite as gone', () => {
  const rewritten = 'SpaceX listed on Nasdaq in June 2026 and trades under the ticker SPCX.'
  assert.equal(excerptStillPresent(SPACEX_EXCERPT, rewritten), false)
})

test('evidenceIsExternal rejects an empty or memory-based reference', () => {
  assert.equal(evidenceIsExternal(MEMORY_WAIVER, { references: [], verificationSources: [] }), false)
  assert.equal(
    evidenceIsExternal(
      { disposition: 'supported', evidenceType: 'reference', evidenceRef: 'This is common knowledge' },
      { references: ['Associated Press — reported the cert grant'], verificationSources: [] }
    ),
    false
  )
})

test('evidenceIsExternal matches a URL regardless of scheme or trailing slash', () => {
  assert.equal(
    evidenceIsExternal(
      { disposition: 'supported', evidenceType: 'verification', evidenceRef: 'see https://www.spacex.com/about/' },
      { references: [], verificationSources: ['http://spacex.com/about'] }
    ),
    true
  )
})

test('significantOverlap pairs two wordings of the same passage, and only those', () => {
  // Differing connectives must not stop a disposition being matched to its
  // issue — this has to clear the 0.6 threshold the pairing uses.
  assert.ok(significantOverlap('the shares do not trade on public markets', 'shares trade on public markets') >= 0.6)
  assert.ok(significantOverlap('curfews imposed after riots in France', 'Supreme Court home distilling ban') < 0.2)
})
