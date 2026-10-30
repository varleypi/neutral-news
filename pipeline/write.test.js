/**
 * Tests for the headline/summary deadlock.
 *
 * Run with: npm test
 *
 * Background: corrections edited `body`, `keyFacts` and `references`, and the
 * gate read `headline`, `summary`, `body` and `keyFacts`. So a contradicted
 * claim whose text sat in the summary could not be removed by any number of
 * correction passes - the gate found it present every time. Not a near miss
 * but a deadlock: two corrections, two validations, then blocked, every time.
 *
 * On 2026-10-30 that took an edition to one published story out of twelve at
 * about $16, and the validator named the cause itself: "the summary
 * mischaracterizes a '$55-billion-plus AI capital spending plan'". The
 * fixtures below are that article.
 *
 * `stalePromotedClaims` decides when a restatement is needed, so these are the
 * tests that keep the deadlock from coming back - and, just as important, keep
 * the pipeline from paying for a restatement call it does not need.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const { stalePromotedClaims } = require('./write')

const ARTICLE = {
  headline: 'Alphabet Shares Tumble After Earnings Beat Raises Questions About AI Spending',
  summary:
    'Alphabet shares fell sharply after a $55-billion-plus AI capital spending plan ' +
    'unsettled investors, wiping out upwards of $500 billion in market value.',
  body:
    'Alphabet shares closed sharply lower on Thursday.\n\n' +
    'The company maintained its full-year 2026 capital spending range of $195 billion ' +
    'to $205 billion, unchanged from July.',
}

test('a claim removed from the body but still asserted by the summary is stale', () => {
  const stale = stalePromotedClaims(
    ARTICLE,
    ['Alphabet shares fell sharply after a $55-billion-plus AI capital spending plan unsettled investors'],
    []
  )
  assert.equal(stale.length, 1)
})

test('the deadlock case: an excerpt that could not be located in the body, because the summary is where it lives', () => {
  // This is the exact shape that blocked the 10/30 edition. `applied` carries
  // a failure, not a success, so nothing in the resolution list says the claim
  // was dealt with - and before the restatement nothing could deal with it.
  const applied = [{
    ok: false,
    action: 'delete',
    excerpt: 'wiping out upwards of $500 billion in market value',
    reason: 'the flagged passage could not be found in the article',
  }]
  const stale = stalePromotedClaims(ARTICLE, [], applied)
  assert.deepEqual(stale, ['wiping out upwards of $500 billion in market value'])
})

test('a stale claim in the headline counts too, where deletion was never an option', () => {
  const applied = [{
    ok: false,
    action: 'delete',
    excerpt: 'Earnings Beat Raises Questions About AI Spending',
    reason: 'the flagged passage could not be found in the article',
  }]
  const stale = stalePromotedClaims(ARTICLE, [], applied)
  assert.equal(stale.length, 1)
})

test('a claim removed from the body and absent from both fields needs no restatement', () => {
  // The common case, and it must not spend a model call: corrections did its
  // job in the body and the headline and summary never mentioned it.
  const stale = stalePromotedClaims(
    ARTICLE,
    ['The company maintained its full-year 2026 capital spending range of $195 billion to $205 billion'],
    []
  )
  assert.deepEqual(stale, [])
})

test('an unlocatable excerpt that is nowhere in the article is not a restatement job', () => {
  // A genuinely bad excerpt - the model quoted something that does not exist.
  // Rewriting the headline cannot fix that, so it must not trigger a call.
  const applied = [{
    ok: false,
    action: 'delete',
    excerpt: 'Alphabet announced a special dividend of $4.00 per share for shareholders of record',
    reason: 'the flagged passage could not be found in the article',
  }]
  assert.deepEqual(stalePromotedClaims(ARTICLE, [], applied), [])
})

test('an excerpt both superseded and unlocatable is reported once', () => {
  const excerpt = 'wiping out upwards of $500 billion in market value'
  const stale = stalePromotedClaims(
    ARTICLE,
    [excerpt],
    [{ ok: false, action: 'delete', excerpt, reason: 'the flagged passage could not be found in the article' }]
  )
  assert.deepEqual(stale, [excerpt])
})

test('a successful body edit is not treated as a stale promoted claim', () => {
  // `applied` entries with ok:true were handled in the body. Only failures and
  // superseded text can strand a claim up front.
  const applied = [{ ok: true, action: 'delete', excerpt: 'Alphabet shares closed sharply lower on Thursday.' }]
  assert.deepEqual(stalePromotedClaims(ARTICLE, [], applied), [])
})

test('an article with no headline or summary is handled without throwing', () => {
  const stale = stalePromotedClaims({ body: 'Something happened.' }, ['a claim'], [])
  assert.deepEqual(stale, [])
})
