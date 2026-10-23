/**
 * Tests for the response-parsing helpers.
 *
 * Run with: npm test
 *
 * These matter more than they look. Every stage used to extract JSON with
 * `text.match(/\{[\s\S]*\}/)` — first brace to last brace — and every stage
 * treated a parse failure as a pass: the review returned a 7.0 "passesReview"
 * default and the validator returned `approved: true` with the note
 * "Auto-approved (validation parse failed)". So a response the pipeline could
 * not read became an article nobody had checked. With server-side search in the
 * mix, responses now routinely carry prose and several JSON-ish fragments
 * around the real answer, which is precisely what the old regex mangled.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const {
  extractJson,
  parseStageResponse,
  collectText,
  collectSearchSources,
  collectSearchErrors,
} = require('./llm')

// ── Naming the real cause of a parse failure ────────────────────────────────
// The 2026-10-19 pilot lost six calls to "No parseable JSON object in model
// response". The cause was not malformed JSON: thinking tokens count against
// max_tokens, the budget was 4000, and the responses were cut off before they
// got to the JSON. Reporting both cases identically sent the diagnosis the
// wrong way, so the stop reason is now part of the error.

test('a truncated response is reported as a budget problem, not a parse problem', () => {
  const content = [{ type: 'text', text: 'Let me work through each claim in turn. First,' }]
  assert.throws(
    () => parseStageResponse(content, 'max_tokens', 'Claim verification'),
    /Claim verification hit the \d+-token output cap/
  )
})

test('a refusal is named as a refusal', () => {
  assert.throws(
    () => parseStageResponse([{ type: 'text', text: '' }], 'refusal', 'Final validation'),
    /declined by the model's safety classifiers/
  )
})

test('an unfinished tool turn is named as one', () => {
  assert.throws(
    () => parseStageResponse([], 'max_legs_reached', 'Draft'),
    /did not finish its tool turn/
  )
})

test('a genuinely malformed response still reports the stop reason', () => {
  assert.throws(
    () => parseStageResponse([{ type: 'text', text: 'no json' }], 'end_turn', 'Draft'),
    /Draft: No parseable JSON object .*end_turn/
  )
})

test('parseStageResponse returns the object when the response is complete', () => {
  const content = [
    { type: 'thinking', thinking: 'searching' },
    { type: 'web_search_tool_result', content: [{ url: 'https://a.com' }] },
    { type: 'text', text: '{"approved": true}' },
  ]
  assert.deepEqual(parseStageResponse(content, 'end_turn', 'Final validation'), { approved: true })
})

test('extracts a plain JSON object', () => {
  assert.deepEqual(extractJson('{"approved": true}'), { approved: true })
})

test('strips markdown fences', () => {
  assert.deepEqual(extractJson('```json\n{"approved": false}\n```'), { approved: false })
})

test('takes the last object when the model narrates first', () => {
  // The shape a searching model produces: reasoning, an illustrative fragment,
  // then the real answer. The old regex spliced from the first `{` to the last
  // `}` and threw.
  const text = `
I checked the listing status first. The schema is {"verdict": "..."} per claim.

Here is my answer:

{"claims": [{"claim": "SpaceX is private", "verdict": "CONTRADICTED"}], "summary": "One claim is out of date."}
`
  const parsed = extractJson(text)
  assert.equal(parsed.claims[0].verdict, 'CONTRADICTED')
  assert.equal(parsed.summary, 'One claim is out of date.')
})

test('handles braces inside string values', () => {
  const parsed = extractJson('{"note": "the model wrote {\\"a\\": 1} in prose", "ok": true}')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.note, 'the model wrote {"a": 1} in prose')
})

test('handles escaped quotes and newlines in a body field', () => {
  const parsed = extractJson('{"body": "He said \\"no\\".\\n\\nThen he left.", "n": 2}')
  assert.equal(parsed.n, 2)
  assert.ok(parsed.body.includes('"no"'))
})

test('recovers when a trailing fragment is not valid JSON', () => {
  // The real object is complete; a later fragment is truncated by max_tokens.
  const text = '{"approved": true, "confidenceScore": 9}\n\nFurther notes: {"remaining": '
  assert.deepEqual(extractJson(text), { approved: true, confidenceScore: 9 })
})

test('throws rather than inventing a default', () => {
  // The caller decides what a failure means, and it must never be "ship it".
  assert.throws(() => extractJson('No JSON here at all.'), /No parseable JSON/)
  assert.throws(() => extractJson(''), /No parseable JSON/)
})

test('collectText ignores thinking and tool blocks', () => {
  const content = [
    { type: 'thinking', thinking: 'let me search' },
    { type: 'web_search_tool_result', content: [{ url: 'https://example.com', title: 'x' }] },
    { type: 'text', text: 'the answer' },
  ]
  assert.equal(collectText(content), 'the answer')
})

test('collectSearchSources returns the URLs actually retrieved, deduplicated', () => {
  const content = [
    { type: 'web_search_tool_result', content: [{ url: 'https://a.com' }, { url: 'https://b.com' }] },
    { type: 'web_search_tool_result', content: [{ url: 'https://a.com' }] },
    { type: 'text', text: 'done' },
  ]
  assert.deepEqual(collectSearchSources(content), ['https://a.com', 'https://b.com'])
})

test('a search error block yields no sources and is reported', () => {
  // Server-tool errors arrive as HTTP 200 with an error object where the result
  // list normally goes — iterating it blindly would throw or, worse, look empty
  // and pass as "nothing to flag".
  const content = [
    { type: 'web_search_tool_result', content: { error_code: 'max_uses_exceeded' } },
    { type: 'text', text: '{}' },
  ]
  assert.deepEqual(collectSearchSources(content), [])
  assert.deepEqual(collectSearchErrors(content), ['max_uses_exceeded'])
})
