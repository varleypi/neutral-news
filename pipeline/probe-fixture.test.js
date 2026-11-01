/**
 * Free tests for the paid probe's fixture.
 *
 * Run with: npm test
 *
 * Why this file exists. The corrections probe costs a model call, so when it
 * fails the failure gets read as news about the model. Twice now it has been
 * news about the fixture instead:
 *
 *   - the first multi-passage probe quoted a sub-sentence clause, which
 *     corrections can never locate, so it failed against every model;
 *   - the three-passage version passed and was taken as evidence that moving
 *     the stage to Haiku was safe, when real editions flag 10 to 19 passages
 *     and 9 of 12 then died on the output cap.
 *
 * So before any call is paid for, assert for free that every flagged excerpt is
 * locatable by the same code the stage uses, and that the fixture is still the
 * size a real edition is. These tests cannot catch an output-cap failure - only
 * a live call can - but they can stop us misreading one.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const { applyResolutions } = require('./corrections')
const { PROP40_ARTICLE, PROP40_ISSUES } = require('./probe')

test('every flagged excerpt is locatable in the body by the production path', () => {
  // One resolution per issue, all deletions, through applyResolutions itself -
  // not locateExcerpt directly. Calling the helper with the wrong argument
  // shape is its own trap: it takes a sentence list, not a body.
  const { applied } = applyResolutions(
    PROP40_ARTICLE.body,
    PROP40_ISSUES.map(i => ({ action: 'delete', excerpt: i.excerpt }))
  )

  const lost = applied.filter(a => !a.ok).map(a => a.excerpt)
  assert.deepEqual(lost, [], `unlocatable excerpt(s) in the fixture: ${JSON.stringify(lost, null, 2)}`)
  assert.equal(applied.length, PROP40_ISSUES.length)
})

test('the fixture is the size a real edition is', () => {
  // 2026-10-31 flagged 10 to 19 passages per story and every story at 10 or
  // more died. A fixture that drifts below that stops being evidence.
  assert.ok(
    PROP40_ISSUES.length >= 10,
    `fixture has ${PROP40_ISSUES.length} flagged passages; real editions flag 10 to 19`
  )
})

test('every flagged passage is a required issue with a correction to act on', () => {
  for (const issue of PROP40_ISSUES) {
    assert.equal(issue.severity, 'required', `not required: ${issue.excerpt}`)
    assert.ok(issue.correction?.length > 20, `no usable correction for: ${issue.excerpt}`)
    assert.ok(issue.type, `no type for: ${issue.excerpt}`)
  }
})

test('the headline and summary assert none of the flagged text', () => {
  // Otherwise the restatement path fires and this probe quietly becomes a test
  // of two stages at once, with a second call on the bill.
  const promoted = `${PROP40_ARTICLE.headline}\n${PROP40_ARTICLE.summary}`
  for (const issue of PROP40_ISSUES) {
    assert.ok(
      !promoted.includes(issue.excerpt),
      `flagged text is in the headline or summary, which makes this a deadlock probe too: ${issue.excerpt}`
    )
  }
})
