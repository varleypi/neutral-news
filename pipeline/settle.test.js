/**
 * Tests for settling a reviewer's "unverifiable" flag against the fact-check.
 *
 * Run with: npm test
 *
 * Settling removes a required issue, so the tests that matter most here are the
 * ones where it must NOT happen. A flag settled wrongly is a claim nobody
 * checked reaching the page with the fact-check's name on it.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const { settleByVerification, claimCovers, contradictedIssues } = require('./verify')

const SENTENCE = 'El-Sayed, a former Wayne County public health director, won by about four points.'
const URL = 'https://apnews.com/michigan'

const flag = (excerpt, type = 'UNVERIFIABLE') => ({ type, severity: 'required', excerpt, correction: 'Not in the source headlines.' })
const claim = (over = {}) => ({
  claim: 'El-Sayed previously served as Wayne County public health director.',
  excerpt: SENTENCE,
  verdict: 'SUPPORTED',
  evidence: 'Wayne County records and AP both describe him as the former county public health director.',
  sources: [URL],
  ...over,
})
const settle = (issues, claims) => settleByVerification(issues, { status: 'ok', claims })

// ── Settles ──────────────────────────────────────────────────────────────────

test('a flagged clause the verifier confirmed is settled, with the evidence recorded', () => {
  const { issues, settled } = settle([flag('a former Wayne County public health director')], [claim()])
  assert.equal(settled.length, 1)
  assert.equal(issues[0].severity, 'suggested')
  assert.deepEqual(issues[0].settledBy.sources, [URL])
  assert.match(issues[0].correction, /Settled by the fact-check/)
})

test('a flag on the whole sentence is settled by a claim quoting that sentence', () => {
  const whole = claim({ claim: 'El-Sayed, formerly Wayne County public health director, won by about four points.' })
  assert.equal(settle([flag(SENTENCE)], [whole]).settled.length, 1)
})

// ── Does not settle ──────────────────────────────────────────────────────────

test('the same sentence supported for a DIFFERENT claim settles nothing', () => {
  // The verifier quoted the sentence to support the margin. That says nothing
  // about his old job, and this is the case the second key exists for.
  const margin = claim({
    claim: 'El-Sayed won the race by about four points.',
    evidence: 'AP put the margin at 4.1 points with 98 percent counted.',
  })
  const { issues, settled } = settle([flag('a former Wayne County public health director')], [margin])
  assert.equal(settled.length, 0)
  assert.equal(issues[0].severity, 'required')
})

test('a figure the verifier never mentioned is not settled by the sentence around it', () => {
  const sentence = 'A recent Emerson College survey found 62 percent of voters opposed new data centers in their county.'
  const about = claim({
    claim: 'An Emerson College survey found most voters opposed new data centers.',
    excerpt: sentence,
    evidence: 'Emerson reported majority opposition among voters to new data centers in their county.',
  })
  assert.equal(settle([flag('survey found 62 percent of voters opposed new data centers')], [about]).settled.length, 0)

  const exact = { ...about, evidence: 'Emerson reported 62 percent of voters opposed.' }
  assert.equal(settle([flag('survey found 62 percent of voters opposed new data centers')], [exact]).settled.length, 1)
})

test('only SUPPORTED claims settle, and only with a page actually retrieved', () => {
  const f = [flag('a former Wayne County public health director')]
  assert.equal(settle(f, [claim({ verdict: 'UNVERIFIED' })]).settled.length, 0)
  assert.equal(settle(f, [claim({ verdict: 'UNCHECKED' })]).settled.length, 0)
  assert.equal(settle(f, [claim({ verdict: 'CONTRADICTED' })]).settled.length, 0)
  assert.equal(settle(f, [claim({ sources: [] })]).settled.length, 0)
})

test('bias, imbalance and editorialising are not questions a source can settle', () => {
  for (const type of ['BIASED', 'IMBALANCED', 'EDITORIAL', 'INACCURATE']) {
    const { issues, settled } = settle([flag('a former Wayne County public health director', type)], [claim()])
    assert.equal(settled.length, 0, type)
    assert.equal(issues[0].severity, 'required', type)
  }
})

test('a flag wider than anything the verifier quoted is left required', () => {
  const narrow = claim({ excerpt: 'a former Wayne County public health director' })
  assert.equal(settle([flag(SENTENCE)], [narrow]).settled.length, 0)
})

test('suggested issues and a missing verification pass straight through', () => {
  const suggested = { ...flag('a former Wayne County public health director'), severity: 'suggested' }
  assert.deepEqual(settle([suggested], [claim()]).issues, [suggested])
  const required = flag('a former Wayne County public health director')
  assert.deepEqual(settleByVerification([required], undefined).issues, [required])
  assert.deepEqual(settleByVerification([required], { status: 'failed', claims: [] }).issues, [required])
})

test('claimCovers refuses a passage too short to mean anything', () => {
  assert.equal(claimCovers(claim(), 'Wayne County'), false)
})

// ── Contradictions become issues ─────────────────────────────────────────────

test('contradicted claims become required issues carrying their evidence', () => {
  const issues = contradictedIssues({
    claims: [
      claim({ verdict: 'CONTRADICTED', evidence: 'He was Detroit health director, not Wayne County.' }),
      claim(),
      claim({ verdict: 'CONTRADICTED', excerpt: '' }), // nothing to locate, nothing to hand over
    ],
  })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].type, 'CONTRADICTED')
  assert.equal(issues[0].severity, 'required')
  assert.match(issues[0].correction, /Detroit health director/)
  assert.match(issues[0].correction, /apnews\.com\/michigan/)
  assert.match(issues[0].correction, /cannot be kept/)
})
