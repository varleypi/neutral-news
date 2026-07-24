/**
 * Tests for cross-day story matching.
 *
 * Run with: npm test
 *
 * The fixtures are drawn from stories that really were published twice on
 * neutralnews.us in July 2026, before the pipeline had any memory of previous
 * days. Both directions matter: a matcher that is too eager collapses genuinely
 * separate stories into one, which loses real coverage.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const { findPriorCoverage, hasMaterialDevelopment, describesSameEvent } = require('./history')

// Articles as they would already sit in neutral_articles, published yesterday.
const RECENT = [
  {
    id: 390,
    date: '2026-07-21',
    cluster_id: 'c-iran-01',
    topic_label: 'US-Iran military strikes over Strait of Hormuz',
    headline: 'US Expands Strikes on Iran After Attacks Kill American Troops',
    summary: 'US forces struck Iranian targets.',
    key_facts: ['Two soldiers killed in Jordan'],
  },
  {
    id: 391,
    date: '2026-07-21',
    cluster_id: 'c-wc-01',
    topic_label: '2026 FIFA World Cup begins, semifinals underway',
    headline: 'Spain Wins Second World Cup, Defeating Argentina in Extra Time',
    summary: 'Spain beat Argentina.',
    key_facts: ['Spain won in extra time'],
  },
  {
    id: 392,
    date: '2026-07-21',
    cluster_id: 'c-uk-01',
    topic_label: 'Andy Burnham becomes UK prime minister',
    headline: 'Andy Burnham Becomes UK Prime Minister After Starmer Resigns',
    summary: 'Burnham took office.',
    key_facts: ['Starmer resigned'],
  },
  {
    id: 393,
    date: '2026-07-21',
    cluster_id: 'c-me-01',
    topic_label: 'Maine Democratic Senate primary race',
    headline: 'Troy Jackson Emerges as Front-Runner in Maine Democratic Senate Race',
    summary: 'Jackson leads.',
    key_facts: ['Jackson leads the field'],
  },
]

test('matches a continuing story that kept its cluster id', () => {
  const hit = findPriorCoverage(
    { clusterId: 'c-iran-01', topicLabel: 'US and Iran conflict deepens' },
    RECENT
  )
  assert.equal(hit?.prior.id, 390)
  assert.equal(hit.matchedOn, 'cluster id')
})

test('matches a continuing story that was re-clustered under a new id', () => {
  // SpinDetector re-clusters daily, so the same running story routinely gets a
  // fresh cluster id overnight. Topic-label similarity has to carry this case.
  const hit = findPriorCoverage(
    { clusterId: 'c-iran-99', topicLabel: 'US-Iran military strikes over Strait of Hormuz' },
    RECENT
  )
  assert.equal(hit?.prior.id, 390)
})

test('does NOT collapse different stages of the same long-running event', () => {
  // This test originally asserted the opposite. Running the backfill against
  // live data disproved it: a multi-week tournament is one SpinDetector cluster
  // but many genuinely distinct stories, and treating "semifinals underway" and
  // "final and aftermath" as one story chained twelve separate World Cup
  // articles — a red card, a group result, the final — into a single group.
  //
  // Shared subject is not shared event. The Jaccard floor on the overlap path
  // is what keeps these apart.
  const hit = findPriorCoverage(
    { clusterId: 'c-wc-02', topicLabel: '2026 FIFA World Cup final and aftermath' },
    RECENT
  )
  assert.equal(hit, null)
})

test('still matches a genuine rewrite of the same result', () => {
  // The pair above must stay separate, but this pair — the same match result
  // rewritten the next day — must still be caught. Both really were published.
  const { same } = describesSameEvent(
    'Spain Wins Second World Cup, Defeating Argentina in Extra Time',
    'Spain Defeats Argentina in Extra Time to Win Second World Cup Title'
  )
  assert.equal(same, true)
})

test('the Jaccard floor rejects a subset label that overlaps perfectly', () => {
  // "2026 FIFA World Cup" sits entirely inside the longer label, so the overlap
  // coefficient scores a perfect 1.0 on its own. The floor is what stops a
  // tournament's every stage collapsing into one story.
  const { same } = describesSameEvent(
    '2026 FIFA World Cup',
    '2026 FIFA World Cup knockout stage drama begins tonight'
  )
  assert.equal(same, false)
})

test('strict mode drops the overlap path entirely', () => {
  // Shares three of four words, so overlap accepts it but Jaccard (0.43) does
  // not clear the 0.5 bar. The pipeline takes the match and then checks whether
  // the story actually developed; the backfill, which has no such second check,
  // runs strict and declines.
  const a = 'Senate passes budget reconciliation'
  const b = 'Senate budget reconciliation nears final vote'

  assert.equal(describesSameEvent(a, b).same, true, 'pipeline (loose) should match')
  assert.equal(describesSameEvent(a, b, { strict: true }).same, false, 'backfill (strict) should not')
})

test('matches a reworded topic label for the same race', () => {
  const hit = findPriorCoverage(
    { clusterId: 'c-me-02', topicLabel: 'Maine Democratic Senate primary field' },
    RECENT
  )
  assert.equal(hit?.prior.id, 393)
})

test('does not match genuinely unrelated stories', () => {
  const unrelated = [
    'Trump approves US-Saudi civil nuclear agreement',
    'Arizona primaries set fall matchups',
    'Trump imposes 50% tariffs on Canadian goods',
    'Israeli military builds earthen barrier in Gaza',
    'OpenAI test model breached company servers',
    'ICE fatally shoots man during Maine immigration operation',
  ]
  for (const topicLabel of unrelated) {
    const hit = findPriorCoverage({ clusterId: 'c-new', topicLabel }, RECENT)
    assert.equal(hit, null, `should not have matched: "${topicLabel}"`)
  }
})

test('two unrelated stories about the same country stay separate', () => {
  // "Maine immigration operation" vs "Maine Democratic Senate primary" share a
  // place name and nothing else — collapsing them would lose real coverage.
  const { same } = describesSameEvent(
    'ICE fatally shoots man during Maine immigration operation',
    'Maine Democratic Senate primary race'
  )
  assert.equal(same, false)
})

test('a rewrite of the same facts counts as no development', () => {
  const { developed } = hasMaterialDevelopment(
    {
      headline: 'Spain Defeats Argentina in Extra Time to Win Second World Cup Title',
      summary: 'Spain beat Argentina.',
      keyFacts: ['Spain won in extra time'],
    },
    RECENT[1]
  )
  assert.equal(developed, false)
})

test('a real new development counts as development', () => {
  const { developed } = hasMaterialDevelopment(
    {
      headline: 'Spain Parade Draws One Million as Squad Returns to Madrid',
      summary: 'Victory parade held in the capital.',
      keyFacts: ['One million attended the parade', 'Squad received by the king'],
    },
    RECENT[1]
  )
  assert.equal(developed, true)
})

test('a new development in a running conflict counts as development', () => {
  const { developed } = hasMaterialDevelopment(
    {
      headline: 'House Votes to Limit War Powers as Conflict Deepens',
      summary: 'The House passed a war powers resolution.',
      keyFacts: ['House voted 221-210', 'Resolution limits presidential authority'],
    },
    RECENT[0]
  )
  assert.equal(developed, true)
})
