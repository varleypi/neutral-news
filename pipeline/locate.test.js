/**
 * Tests for finding - and acting on - a flagged passage that is part of a sentence.
 *
 * Run with: npm test
 *
 * The passages are real. Each was reported as "could not be found in the
 * article" by the correction step on 2026-11-04, on drafts that were then
 * discarded: they are clauses, and the matcher only knew how to find whole
 * sentences. The sentences around them are reconstructions - the run log keeps
 * the excerpt, not the article.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const { applyResolutions, locateExcerpt, locateContained, splitSentences, refuseToKeepContradicted } = require('./corrections')
const { evaluateGate, issuesBehind, contradictedIssue } = require('./gate')
const { correctionSearchBudget, cutUnsupported, MIN_WORDS_AFTER_CUT } = require('./write')

const BODY =
  'Abdul El-Sayed won the Michigan Senate race on Tuesday. El-Sayed, a former Wayne County public health ' +
  'director, later served as the state\'s health official during the pandemic and campaigned on economic ' +
  'populism and had the backing of Senator Bernie Sanders.\n\n' +
  'Supporters called health costs a kitchen-table issue for the state. The Associated Press called the race ' +
  'shortly after midnight.'

const sentences = splitSentences(BODY.replace(/\n{2,}/g, ' '))

// ── Finding ──────────────────────────────────────────────────────────────────

test('a clause quoted out of a long sentence is found in that sentence', () => {
  const hit = locateExcerpt(sentences, 'a former Wayne County public health director')
  assert.ok(hit, 'the 11/04 passage must be locatable')
  assert.equal(hit.contained, true)
  assert.match(sentences[hit.start], /Wayne County/)
  assert.equal(hit.end - hit.start, 1)
})

test('three words are enough when they are exact and appear once', () => {
  const hit = locateExcerpt(sentences, 'kitchen-table issue')
  assert.ok(hit)
  assert.match(sentences[hit.start], /kitchen-table/)
})

test('a short phrase that appears in two sentences is not an address', () => {
  // Cutting the first sentence that happens to contain it would be a guess.
  const twice = ['The bill passed the Senate on Tuesday.', 'Critics said the bill passed the Senate too quickly.']
  assert.equal(locateContained(twice, 'passed the Senate'), null)
})

test('two words are never enough', () => {
  assert.equal(locateContained(sentences, 'health costs'), null)
})

test('the words have to run together, not merely all be present', () => {
  // Every word of this is somewhere in the Wayne County sentence. As a bag of
  // words it matches; as a passage it does not exist.
  assert.equal(locateContained(sentences, 'Senator Sanders served as a former county health official'), null)
})

test('a clause that straddles two sentences is found across both', () => {
  const pair = ['Turnout rose in most counties and officials credited early voting.', 'They also credited mild weather, according to the secretary of state.']
  const hit = locateContained(pair, 'officials credited early voting. They also credited mild weather')
  assert.ok(hit)
  assert.equal(hit.end - hit.start, 2)
})

test('a passage that is not in the article is still reported as not found', () => {
  assert.equal(locateExcerpt(sentences, 'the Supreme Court agreed to hear a challenge to the ban'), null)
})

// ── Acting ───────────────────────────────────────────────────────────────────

test('deleting a clause removes the sentence it sits in and nothing else', () => {
  const { body, applied } = applyResolutions(BODY, [
    { excerpt: 'a former Wayne County public health director', action: 'delete' },
  ])
  assert.equal(applied[0].ok, true)
  assert.ok(!/Wayne County/.test(body))
  assert.ok(/won the Michigan Senate race/.test(body))
  assert.ok(/kitchen-table/.test(body))
})

test('a replacement for a clause stands in for the whole sentence', () => {
  const { body, applied } = applyResolutions(BODY, [{
    excerpt: 'kitchen-table issue',
    action: 'replace',
    replacement: 'Supporters said health costs were a leading concern for voters.',
  }])
  assert.equal(applied[0].ok, true)
  assert.ok(!/kitchen-table/.test(body))
  assert.ok(/leading concern for voters\. The Associated Press/.test(body))
})

test('three clauses flagged in one sentence resolve without tripping over each other', () => {
  // All three of these came back unfound on 11/04, in one correction call.
  const { body, applied } = applyResolutions(BODY, [
    { excerpt: 'a former Wayne County public health director', action: 'delete' },
    { excerpt: 'later served as the state\'s health official during the pandemic', action: 'delete' },
    { excerpt: 'campaigned on economic populism and had the backing of Senator Bernie Sanders', action: 'delete' },
  ])
  assert.equal(applied[0].ok, true)
  assert.ok(!/Wayne County|pandemic|Bernie Sanders/.test(body), 'none of the three survives')
})

// ── A contradiction cannot be kept ───────────────────────────────────────────

test('a "keep" on a contradicted claim becomes a deletion', () => {
  const issues = [{ type: 'CONTRADICTED', severity: 'required', excerpt: 'Texas Governor Greg Abbott won reelection against Democrat Gina Hinojosa.' }]
  const { resolutions, overruled } = refuseToKeepContradicted(
    [{ excerpt: 'Texas Governor Greg Abbott won reelection against Democrat Gina Hinojosa.', action: 'keep', reference: 'Some outlet — said so' }],
    issues
  )
  assert.equal(resolutions[0].action, 'delete')
  assert.equal(overruled.length, 1)
})

test('a "keep" on anything else is left alone, and so are the other actions', () => {
  const issues = [
    { type: 'CONTRADICTED', severity: 'required', excerpt: 'Texas Governor Greg Abbott won reelection against Democrat Gina Hinojosa.' },
    { type: 'UNVERIFIED', severity: 'required', excerpt: 'Turnout rose in most counties.' },
  ]
  const input = [
    { excerpt: 'Turnout rose in most counties.', action: 'keep', reference: 'AP — reported turnout' },
    { excerpt: 'Texas Governor Greg Abbott won reelection against Democrat Gina Hinojosa.', action: 'replace', replacement: 'x', reference: 'https://a.example' },
  ]
  const { resolutions, overruled } = refuseToKeepContradicted(input, issues)
  assert.deepEqual(resolutions, input)
  assert.deepEqual(overruled, [])
})

// ── The gate names what blocked ──────────────────────────────────────────────

const ARTICLE = { headline: 'El-Sayed Wins', summary: 'He won.', body: BODY, keyFacts: [], references: [] }
const APPROVED = { approved: true, requiredIssueDispositions: [] }

test('each blocker carries the passage behind it, and issuesBehind collects them once', () => {
  const stuck = { type: 'UNVERIFIABLE', severity: 'required', excerpt: 'a former Wayne County public health director', correction: 'x' }
  const gone = { type: 'UNVERIFIED', severity: 'required', excerpt: 'Rogers conceded in a brief statement to supporters.', correction: 'x' }
  const claim = { claim: 'AP called it after midnight', excerpt: 'The Associated Press called the race shortly after midnight.', verdict: 'CONTRADICTED', evidence: 'It was called at 9pm.', sources: ['https://apnews.com/x'] }

  const gate = evaluateGate({
    article: ARTICLE,
    review: { issues: [stuck, gone, contradictedIssue(claim)] },
    validation: APPROVED,
    verification: { status: 'ok', claims: [claim] },
  })

  assert.equal(gate.passed, false)
  assert.equal(gate.blockers.filter(b => b.kind === 'CONTRADICTED_CLAIM').length, 1, 'raised once, not once per rule')
  const behind = issuesBehind(gate.blockers)
  assert.deepEqual(behind.map(i => i.type).sort(), ['CONTRADICTED', 'UNVERIFIABLE'])
  assert.match(behind.find(i => i.type === 'CONTRADICTED').correction, /called at 9pm.*apnews\.com/s)
})

test('a blocker with no passage behind it gives corrections nothing to do', () => {
  const gate = evaluateGate({
    article: ARTICLE, review: { issues: [] },
    validation: { approved: false, validationNotes: 'Tone.', requiredIssueDispositions: [] },
    verification: { status: 'ok', claims: [] },
  })
  assert.deepEqual(gate.blockers.map(b => b.kind), ['VALIDATION_NOT_APPROVED'])
  assert.deepEqual(issuesBehind(gate.blockers), [])
})

// ── Budget and the cut ───────────────────────────────────────────────────────

test('the search budget follows the workload and never counts a contradiction', () => {
  const issue = type => ({ type, severity: 'required', excerpt: 'x' })
  assert.equal(correctionSearchBudget([issue('CONTRADICTED')]), 3)
  assert.equal(correctionSearchBudget([issue('UNVERIFIED'), issue('BIASED')]), 3)
  assert.equal(correctionSearchBudget(Array.from({ length: 5 }, () => issue('UNVERIFIED'))), 5)
  assert.equal(correctionSearchBudget(Array.from({ length: 19 }, () => issue('UNVERIFIABLE'))), 8)
  assert.equal(
    correctionSearchBudget([...Array.from({ length: 4 }, () => issue('UNVERIFIED')), ...Array.from({ length: 6 }, () => issue('CONTRADICTED'))]),
    4
  )
})

test('the cut declines to leave an article too short to publish', async () => {
  const short = { ...ARTICLE }
  assert.ok(BODY.split(/\s+/).length < MIN_WORDS_AFTER_CUT + 40, 'fixture is meant to be near the floor')
  const { article, cut, tooShort } = await cutUnsupported(short, [
    { type: 'UNVERIFIED', severity: 'required', excerpt: 'The Associated Press called the race shortly after midnight.' },
  ])
  assert.equal(tooShort, true)
  assert.equal(cut, 0)
  assert.equal(article.body, BODY, 'returned untouched, for the gate to block')
})
