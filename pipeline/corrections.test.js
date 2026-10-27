/**
 * Tests for applying required corrections.
 *
 * Run with: npm test
 *
 * The fixtures are the real thing: the SpaceX article published 2026-10-19
 * with its stale ownership claim, and passages from the 2026-10-24 edition
 * where the writer was handed required corrections and returned the article
 * unchanged. The whole point of this module is that an edit it performs cannot
 * be a no-op, so most of these tests assert that the flagged text is gone.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const {
  applyResolutions,
  pruneKeyFacts,
  supersededExcerpts,
  enforceSourcedReplacements,
  locateExcerpt,
  splitSentences,
  matchScore,
} = require('./corrections')

const SPACEX_EXCERPT =
  'SpaceX, which he founded in 2002, remains privately held, meaning its shares do not ' +
  'trade on public markets and have historically been held by employees, early investors, ' +
  'and institutional backers.'

const SPACEX_BODY =
  'Elon Musk said Sunday that he intends to give one of his SpaceX shares to every child ' +
  'in America, a pledge he described as the first of many.\n\n' +
  SPACEX_EXCERPT + ' The pledge would be the largest of its kind.\n\n' +
  'As of now, the pledge exists only as a public statement from Musk.'

// ── Deletion ─────────────────────────────────────────────────────────────────

test('deleting the flagged passage actually removes it', () => {
  const { body, applied } = applyResolutions(SPACEX_BODY, [
    { excerpt: SPACEX_EXCERPT, action: 'delete' },
  ])

  assert.equal(applied[0].ok, true)
  assert.ok(!/privately held/i.test(body), `still present:\n${body}`)
  // Its neighbours survive.
  assert.ok(/every child/.test(body))
  assert.ok(/largest of its kind/.test(body))
  assert.ok(/public statement from Musk/.test(body))
})

test('paragraph breaks survive an edit', () => {
  const { body } = applyResolutions(SPACEX_BODY, [{ excerpt: SPACEX_EXCERPT, action: 'delete' }])
  assert.equal(body.split('\n\n').length, 3)
})

test('a paragraph emptied by a deletion disappears rather than leaving a gap', () => {
  const body = 'First para.\n\nOnly sentence here.\n\nThird para.'
  const { body: out } = applyResolutions(body, [{ excerpt: 'Only sentence here.', action: 'delete' }])
  assert.equal(out, 'First para.\n\nThird para.')
})

// ── Replacement ──────────────────────────────────────────────────────────────

test('replacing swaps the text and leaves the rest alone', () => {
  const { body, applied } = applyResolutions(SPACEX_BODY, [{
    excerpt: SPACEX_EXCERPT,
    action: 'replace',
    replacement: 'SpaceX listed on Nasdaq in June 2026 and trades under the ticker SPCX.',
  }])

  assert.equal(applied[0].ok, true)
  assert.ok(/trades under the ticker SPCX/.test(body))
  assert.ok(!/privately held/i.test(body))
  assert.ok(/largest of its kind/.test(body))
})

test('a replace with no replacement text is refused, not silently dropped', () => {
  const { body, applied } = applyResolutions(SPACEX_BODY, [
    { excerpt: SPACEX_EXCERPT, action: 'replace', replacement: '   ' },
  ])
  assert.equal(applied[0].ok, false)
  assert.match(applied[0].reason, /no replacement text/)
  assert.ok(/privately held/i.test(body), 'the body must be left untouched when a resolution is refused')
})

// ── Drift between the quoted excerpt and the article ─────────────────────────

test('matches an excerpt quoted back with a trimmed clause', () => {
  // What a reviewer actually quotes: the assertion, minus the tail.
  const trimmed = 'SpaceX, which he founded in 2002, remains privately held'
  const { body, applied } = applyResolutions(SPACEX_BODY, [{ excerpt: trimmed, action: 'delete' }])
  assert.equal(applied[0].ok, true)
  assert.ok(!/privately held/i.test(body))
})

test('matches across smart quotes and an ellipsis', () => {
  const body = 'In Limoges, the town hall was set ablaze. In Lyon, a tourist office was set on fire. Elsewhere it was calm.'
  const excerpt = 'In Limoges, the town hall was set ablaze… in Lyon… a tourist office was set on fire'
  const { body: out, applied } = applyResolutions(body, [{ excerpt, action: 'delete' }])
  assert.equal(applied[0].ok, true)
  assert.equal(out, 'Elsewhere it was calm.')
})

test('an excerpt that is not in the article is reported, not guessed at', () => {
  const { body, applied } = applyResolutions(SPACEX_BODY, [
    { excerpt: 'The Supreme Court agreed to hear a challenge to the federal ban on home distilling.', action: 'delete' },
  ])
  assert.equal(applied[0].ok, false)
  assert.match(applied[0].reason, /could not be found/)
  assert.equal(body, SPACEX_BODY.replace(/\n{2,}/g, '\n\n'))
})

test('a short excerpt does not swallow the paragraph around it', () => {
  // Coverage alone would match these three words to the whole paragraph.
  const body = 'Protesters gathered in the square. Police deployed tear gas in Lille. The crowd dispersed by midnight.'
  const { body: out, applied } = applyResolutions(body, [{ excerpt: 'tear gas in Lille', action: 'delete' }])
  assert.equal(applied[0].ok, true)
  assert.ok(/Protesters gathered/.test(out))
  assert.ok(/crowd dispersed/.test(out))
  assert.ok(!/tear gas/.test(out))
})

// ── Several corrections at once ──────────────────────────────────────────────

test('multiple resolutions all land, and later ones are not thrown off by earlier edits', () => {
  const body =
    'Ukraine launched more than 1,000 drones overnight.\n\n' +
    'At least 550,000 households lost power and many were left without heat.\n\n' +
    'Russia struck 28 critical energy facilities, Zelenskyy said. Both grids came under fire.'

  const { body: out, applied } = applyResolutions(body, [
    { excerpt: 'At least 550,000 households lost power and many were left without heat.', action: 'delete' },
    { excerpt: 'Both grids came under fire.', action: 'delete' },
    { excerpt: 'Ukraine launched more than 1,000 drones overnight.', action: 'replace',
      replacement: 'Ukraine launched more than 1,000 drones overnight, Ukrainian officials said.' },
  ])

  assert.deepEqual(applied.map(a => a.ok), [true, true, true])
  assert.ok(!/550,000/.test(out))
  assert.ok(!/Both grids/.test(out))
  assert.ok(/Ukrainian officials said/.test(out))
  assert.ok(/28 critical energy facilities/.test(out))
})

test('one unmatched resolution does not stop the others', () => {
  const { body, applied } = applyResolutions(SPACEX_BODY, [
    { excerpt: 'something that is not in the article at all, about distilling spirits', action: 'delete' },
    { excerpt: SPACEX_EXCERPT, action: 'delete' },
  ])
  assert.equal(applied[0].ok, false)
  assert.equal(applied[1].ok, true)
  assert.ok(!/privately held/i.test(body))
})

// ── Key facts ────────────────────────────────────────────────────────────────

test('a key fact restating a removed passage goes with it', () => {
  // The 10/19 article carried the false claim in both places; editing only the
  // body would have left it in the more prominent one.
  const keyFacts = [
    'Musk said he will give one SpaceX share to each child in the US.',
    'SpaceX is privately held; shares do not trade on public markets.',
  ]
  const pruned = pruneKeyFacts(keyFacts, [SPACEX_EXCERPT])
  assert.equal(pruned.length, 1)
  assert.ok(/give one SpaceX share/.test(pruned[0]))
})

test('unrelated key facts are left alone', () => {
  const keyFacts = ['The court granted certiorari.', 'Sentencing has not yet occurred.']
  assert.deepEqual(pruneKeyFacts(keyFacts, [SPACEX_EXCERPT]), keyFacts)
})

test('a replacement supersedes the claim, so its key fact goes too', () => {
  // The probe caught this live: the body was corrected properly and the key
  // fact restating the old claim stayed, leaving the falsehood on the page in
  // the more prominent of the two places - the same two-places failure as the
  // article that started all of this.
  const { applied } = applyResolutions(SPACEX_BODY, [{
    excerpt: SPACEX_EXCERPT,
    action: 'replace',
    replacement: 'SpaceX listed on Nasdaq in June 2026 and trades as SPCX.',
  }])

  const superseded = supersededExcerpts(applied)
  const pruned = pruneKeyFacts([
    'Musk said he will give one SpaceX share to each child in the US.',
    'SpaceX is privately held; shares do not trade on public markets.',
  ], superseded)

  assert.equal(pruned.length, 1)
  assert.ok(!/privately held/i.test(pruned.join(' ')))
})

test('supersededExcerpts ignores resolutions that did not apply', () => {
  // A resolution that matched nothing must not prune a key fact: the body
  // still says whatever it said.
  const { applied } = applyResolutions(SPACEX_BODY, [
    { excerpt: 'a passage that is nowhere in this article, about home distilling', action: 'delete' },
  ])
  assert.deepEqual(supersededExcerpts(applied), [])
})

test('a kept passage supersedes nothing', () => {
  assert.deepEqual(supersededExcerpts([{ excerpt: 'x', action: 'keep', ok: true }]), [])
})

// ── Rewrites must be sourced ──────────────────────────────────────────
// On 2026-10-26 the correction step chose replace 62 times and delete 7, and
// every rewrite became a new claim the next round flagged. Telling it to prefer
// cutting did not work, so the rule is enforced rather than requested.

test('a rewrite citing a retrieved page is kept', () => {
  const { resolutions, downgraded } = enforceSourcedReplacements(
    [{ excerpt: 'x', action: 'replace', replacement: 'y', reference: 'Reuters — https://reuters.com/article/a1' }],
    ['https://reuters.com/article/a1']
  )
  assert.equal(resolutions[0].action, 'replace')
  assert.deepEqual(downgraded, [])
})

test('a rewrite with no source becomes a deletion', () => {
  const { resolutions, downgraded } = enforceSourcedReplacements(
    [{ excerpt: 'x', action: 'replace', replacement: 'y', reference: 'widely reported' }],
    ['https://reuters.com/article/a1']
  )
  assert.equal(resolutions[0].action, 'delete')
  assert.deepEqual(downgraded, ['x'])
})

test('a rewrite citing a page that was never opened becomes a deletion', () => {
  // The loophole that matters: a plausible URL the model produced from memory.
  const { resolutions } = enforceSourcedReplacements(
    [{ excerpt: 'x', action: 'replace', replacement: 'y', reference: 'https://en.wikipedia.org/wiki/SpaceX' }],
    ['https://reuters.com/article/a1']
  )
  assert.equal(resolutions[0].action, 'delete')
})

test('URL matching survives scheme, www and trailing slash', () => {
  const { resolutions } = enforceSourcedReplacements(
    [{ excerpt: 'x', action: 'replace', replacement: 'y', reference: 'see https://www.Reuters.com/article/a1/' }],
    ['http://reuters.com/article/a1']
  )
  assert.equal(resolutions[0].action, 'replace')
})

test('delete and keep are left alone', () => {
  const { resolutions, downgraded } = enforceSourcedReplacements(
    [{ excerpt: 'a', action: 'delete' }, { excerpt: 'b', action: 'keep', reference: 'AP — reported it' }],
    []
  )
  assert.deepEqual(resolutions.map(r => r.action), ['delete', 'keep'])
  assert.deepEqual(downgraded, [])
})

// ── Primitives ───────────────────────────────────────────────────────────────

test('splitSentences keeps terminators and drops empties', () => {
  assert.deepEqual(
    splitSentences('One thing happened. Then another!  And a third?'),
    ['One thing happened.', 'Then another!', 'And a third?']
  )
})

test('locateExcerpt returns null rather than a bad guess', () => {
  const sentences = ['Protesters gathered in the square.', 'The crowd dispersed by midnight.']
  assert.equal(locateExcerpt(sentences, 'SpaceX listed on Nasdaq under SPCX'), null)
  assert.equal(locateExcerpt(sentences, ''), null)
})

test('matchScore punishes a mismatch in length in both directions', () => {
  const short = ['tear', 'gas']
  const long = ['protesters', 'gathered', 'square', 'police', 'deployed', 'tear', 'gas', 'lille', 'crowd', 'dispersed']
  assert.ok(matchScore(short, long) < 0.5, 'a two-word excerpt must not match a ten-word window')
  assert.ok(matchScore(short, ['police', 'deployed', 'tear', 'gas']) >= 0.5)
})
