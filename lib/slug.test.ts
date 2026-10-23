import test from 'node:test'
import assert from 'node:assert/strict'
import { articlePath, articleSlug, parseArticleParam, slugify } from './slug.ts'

test('slugify lowercases and hyphenates a headline', () => {
  assert.equal(
    slugify('Senate Passes Federal Budget Bill 52-48 After Three-Day Debate'),
    'senate-passes-federal-budget-bill-52-48-after-three-day-debate'
  )
})

test('slugify elides apostrophes rather than breaking on them', () => {
  assert.equal(slugify("Trump's Tariff Plan"), 'trumps-tariff-plan')
  assert.equal(slugify('Trump’s Tariff Plan'), 'trumps-tariff-plan')
})

test('slugify folds accents to ASCII instead of dropping the letter', () => {
  assert.equal(slugify('Protests in Bogotá and Zürich'), 'protests-in-bogota-and-zurich')
})

test('slugify strips punctuation and collapses separators', () => {
  assert.equal(slugify('Fed Holds Rate at 4.5%, Cites "Mixed" Data'), 'fed-holds-rate-at-4-5-cites-mixed-data')
})

test('slugify truncates at a word boundary', () => {
  const slug = slugify(
    'A Very Long Headline About Something Consequential That Keeps Going Well Past Any Reasonable Length'
  )
  assert.ok(slug.length <= 72, `slug was ${slug.length} characters`)
  assert.ok(!slug.endsWith('-'))
  // The cut lands between words, so the last word is never a fragment.
  assert.ok('a-very-long-headline-about-something-consequential-that-keeps-going-well-past-any-reasonable-length'.startsWith(`${slug}-`))
})

test('a headline with no usable characters still produces a routable path', () => {
  assert.equal(articleSlug({ id: 902, headline: '— — —' }), '902')
  assert.equal(articlePath({ id: 902, headline: '' }), '/article/902')
})

test('articlePath ends with the id so lookups survive a re-worded headline', () => {
  assert.equal(
    articlePath({ id: 902, headline: 'Senate Passes Budget' }),
    '/article/senate-passes-budget-902'
  )
})

test('parseArticleParam reads the id back out of a slug', () => {
  assert.equal(parseArticleParam('senate-passes-budget-902'), 902)
})

test('parseArticleParam accepts the bare numeric URLs the site used to serve', () => {
  assert.equal(parseArticleParam('902'), 902)
})

test('parseArticleParam rejects anything without a trailing id', () => {
  assert.equal(parseArticleParam('senate-passes-budget'), null)
  assert.equal(parseArticleParam(''), null)
  assert.equal(parseArticleParam('0'), null)
  assert.equal(parseArticleParam('-1'), null)
  assert.equal(parseArticleParam('12.5'), null)
  assert.equal(parseArticleParam(`${'a-'.repeat(200)}1`), null)
})

test('every slug round-trips back to its own id', () => {
  const headlines = [
    'Senate Passes Federal Budget Bill 52-48 After Three-Day Debate',
    "Trump's Tariff Plan Draws Objections",
    'Protests in Bogotá and Zürich',
    '— — —',
    'A Very Long Headline About Something Consequential That Keeps Going Well Past Any Reasonable Length',
  ]

  for (const [index, headline] of headlines.entries()) {
    const id = index + 1
    assert.equal(parseArticleParam(articleSlug({ id, headline })), id, headline)
  }
})
