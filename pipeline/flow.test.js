/**
 * Tests for the flow between stages - the part no single-stage fixture shows.
 *
 * Run with: npm test
 *
 * Every model call is stubbed, so these are free. What is NOT stubbed is
 * everything that decides: the gate, the sentence editor, the settlement of
 * reviewer flags against the fact-check, and the order the stages run in.
 *
 * The fixtures are the 2026-11-04 edition. That day the pipeline drafted twelve
 * stories to publish five, and the log shows why in the stories it threw away:
 *
 *   - The El-Sayed article passed validation at 8.8 on its first pass and was
 *     blocked on three passages corrections could not find, all of them parts
 *     of sentences ("a former Wayne County public health director"). The retry
 *     then verified it from scratch, the verifier ran out of search budget on
 *     one new sentence, and with no stage left to act on that the draft was
 *     discarded - for a claim nobody had found anything wrong with.
 *   - The data-centre article carried two claims the verifier had CONTRADICTED,
 *     with the correct facts and the pages that showed them, and neither was
 *     ever handed to the stage that edits. The validator declined it for
 *     exactly that reason.
 */

const { test } = require('node:test')
const assert = require('node:assert')

const { processCluster, checkArticle } = require('./run')
const { cutUnsupported } = require('./write')
const { applyResolutions } = require('./corrections')
const { excerptStillPresent } = require('./gate')

const CLUSTER = { clusterId: 'c1', topicLabel: 'Abdul El-Sayed wins Michigan Senate race', outletCount: 7, articles: [] }

const SENTENCES = {
  lede: 'Abdul El-Sayed won the Michigan Senate race on Tuesday, defeating Republican Mike Rogers.',
  bio: 'El-Sayed, a former Wayne County public health director, campaigned on lowering health costs.',
  margin: 'The Associated Press called the race shortly after midnight with El-Sayed leading by about four points.',
  seat: 'He will fill the seat left open by the retirement of Senator Gary Peters.',
  spending: 'The race was among the most closely watched and expensive contests of the 2026 midterms, drawing heavy spending from outside groups on both sides.',
  first: 'El-Sayed becomes the first Muslim elected to the Senate from Michigan.',
  rogers: 'Rogers conceded in a brief statement and thanked his supporters across the state.',
  turnout: 'State officials reported turnout above the level of the last midterm election in most counties.',
  agenda: 'El-Sayed said his first priority in office would be the cost of prescription drugs.',
  swear: 'He is expected to be sworn in when the new Congress convenes in January.',
  filler1: 'Michigan has been one of the most closely divided states in recent national elections.',
  filler2: 'Both parties treated the seat as central to control of the chamber for the next two years.',
  filler3: 'Voters interviewed outside polling places most often named the economy and health care as their concerns.',
  filler4: 'Rogers, a former congressman, had led in several early surveys before the race tightened in October.',
  filler5: 'El-Sayed thanked volunteers at a gathering in Detroit and said the campaign had knocked on more than a million doors.',
  filler6: 'The result leaves both of the state\'s Senate seats in Democratic hands.',
  filler7: 'Election officials said the count proceeded without significant disruption in any of the largest counties.',
  filler8: 'Results will be certified by the Board of State Canvassers later this month.',
  filler9: 'Party leaders in Lansing said they expected the outcome to shape the coming session of the legislature.',
  filler10: 'National groups on both sides had described the contest as a test of their messages for the year.',
  filler11: 'Peters, who announced his retirement last year, congratulated his successor in a statement on Wednesday morning.',
  filler12: 'The Senate seat was last won by a Republican in the 1990s, according to state election records.',
}

function articleFrom(keys) {
  const list = keys.map(k => SENTENCES[k])
  const paragraphs = []
  for (let i = 0; i < list.length; i += 2) paragraphs.push(list.slice(i, i + 2).join(' '))
  return {
    headline: 'Abdul El-Sayed Wins Michigan Senate Race, Defeating Mike Rogers',
    summary: 'Abdul El-Sayed defeated Mike Rogers in Michigan and will succeed the retiring Gary Peters.',
    body: paragraphs.join('\n\n'),
    keyFacts: ['El-Sayed defeated Rogers in the Michigan Senate race.'],
    references: ['Associated Press — called the race for El-Sayed'],
  }
}

const ALL = Object.keys(SENTENCES)
const SOURCE = 'https://apnews.com/michigan-senate-result'

const supported = key => ({
  claim: SENTENCES[key], excerpt: SENTENCES[key], verdict: 'SUPPORTED', evidence: 'AP reports this.', sources: [SOURCE],
})

const verificationOf = claims => ({ status: 'ok', claims, sourcesRetrieved: [SOURCE], summary: '' })

const approve = dispositions => ({
  approved: true, confidenceScore: 8.8, neutralityRating: 'Good',
  requiredIssueDispositions: dispositions, remainingIssues: [], validationNotes: 'ok',
})

/** Stubs that record what each stage was handed. */
function stagesFor({ drafts, reviews, verifications, corrections, validations }) {
  const calls = { applyCorrections: [], cutUnsupported: [], claudeFinalValidation: [], verifyClaims: 0 }
  return {
    calls,
    writeDraft: async () => drafts.shift(),
    grokReview: async () => reviews.shift(),
    verifyClaims: async () => { calls.verifyClaims++; return verifications.shift() },
    applyCorrections: async (article, issues, opts) => {
      calls.applyCorrections.push({ issues, opts })
      return corrections.shift()(article, issues)
    },
    cutUnsupported: async (article, issues) => {
      calls.cutUnsupported.push(issues)
      return cutUnsupported(article, issues)
    },
    claudeFinalValidation: async (article, review) => {
      calls.claudeFinalValidation.push({ article, review })
      return validations.shift()(article, review)
    },
  }
}

/** A corrections stub that applies real edits: delete every passage handed to it. */
const deleteAll = (article, issues) => {
  const { body } = applyResolutions(article.body, issues.map(i => ({ excerpt: i.excerpt, action: 'delete' })))
  return { article: { ...article, body }, applied: [], unresolved: [] }
}

/** A corrections stub that changes nothing - a model that could not find anything to do. */
const changeNothing = article => ({ article, applied: [], unresolved: [] })

test('a fresh finding on the retry is cut and the draft publishes, where it used to be discarded', async () => {
  // First pass: the reviewer raises a bias flag the corrections step fails to
  // act on, so the gate blocks. Retry: corrections fixes it, and the fresh
  // verification then reports one sentence UNCHECKED - out of budget, not
  // wrong. On 2026-11-04 that was the end of this draft.
  const bias = { type: 'BIASED', severity: 'required', excerpt: 'campaigned on lowering health costs', correction: 'Loaded framing.' }
  const stages = stagesFor({
    drafts: [articleFrom(ALL)],
    reviews: [{ overallScore: 6, issues: [bias] }],
    verifications: [
      verificationOf(ALL.map(supported)),
      verificationOf([
        ...ALL.filter(k => k !== 'spending' && k !== 'bio').map(supported),
        { claim: 'The race was among the most expensive of 2026.', excerpt: SENTENCES.spending, verdict: 'UNCHECKED', evidence: '', sources: [] },
      ]),
    ],
    corrections: [changeNothing, deleteAll],
    validations: [
      (_, review) => approve(review.issues.filter(i => i.severity === 'required')
        .map(i => ({ excerpt: i.excerpt, disposition: 'supported', evidenceType: 'none', evidenceRef: '', note: '' }))),
      () => approve([]),
    ],
  })

  const result = await processCluster(CLUSTER, '2026-11-04', stages)

  assert.equal(result.gate.passed, true, JSON.stringify(result.gate.blockers.map(b => b.kind)))
  assert.ok(!result.article.body.includes('most closely watched and expensive'), 'the unchecked sentence was cut')
  assert.ok(!result.article.body.includes('former Wayne County'), 'the sentence holding the flagged clause was cut')
  assert.ok(result.article.body.includes('defeating Republican Mike Rogers'), 'the rest of the article is intact')
})

test('the retry corrects only what blocked, not everything ever flagged', async () => {
  const fixed = { type: 'UNVERIFIED', severity: 'required', excerpt: SENTENCES.turnout, correction: 'Could not be confirmed.' }
  const stuck = { type: 'BIASED', severity: 'required', excerpt: 'campaigned on lowering health costs', correction: 'Loaded framing.' }
  const stages = stagesFor({
    drafts: [articleFrom(ALL)],
    reviews: [{ overallScore: 6, issues: [fixed, stuck] }],
    verifications: [verificationOf(ALL.map(supported)), verificationOf(ALL.filter(k => k !== 'bio' && k !== 'turnout').map(supported))],
    // First pass fixes one of the two and leaves the other standing.
    corrections: [(article) => deleteAll(article, [fixed]), deleteAll],
    validations: [
      (_, review) => approve(review.issues.filter(i => i.severity === 'required')
        .map(i => ({ excerpt: i.excerpt, disposition: 'supported', evidenceType: 'none', evidenceRef: '', note: '' }))),
      () => approve([]),
    ],
  })

  const result = await processCluster(CLUSTER, '2026-11-04', stages)

  const [first, second] = stages.calls.applyCorrections
  assert.equal(first.issues.length, 2)
  assert.deepEqual(second.issues.map(i => i.excerpt), [stuck.excerpt], 'the retry was handed the one passage that blocked')
  assert.equal(result.gate.passed, true)
})

test('a contradicted claim reaches corrections with the evidence and the page that showed it', async () => {
  const contradicted = {
    claim: 'Texas Governor Greg Abbott won reelection.',
    excerpt: SENTENCES.rogers,
    verdict: 'CONTRADICTED',
    evidence: 'AP reports the opposite.',
    sources: [SOURCE],
  }
  const stages = stagesFor({
    drafts: [articleFrom(ALL)],
    reviews: [{ overallScore: 7, issues: [] }],
    verifications: [verificationOf([...ALL.filter(k => k !== 'rogers').map(supported), contradicted])],
    corrections: [deleteAll],
    validations: [() => approve([])],
  })

  const result = await processCluster(CLUSTER, '2026-11-04', stages)

  const [{ issues, opts }] = stages.calls.applyCorrections
  assert.equal(issues.length, 1)
  assert.equal(issues[0].type, 'CONTRADICTED')
  assert.match(issues[0].correction, /AP reports the opposite/)
  assert.match(issues[0].correction, /apnews\.com/)
  assert.deepEqual(opts.evidenceSources, [SOURCE], 'the verifier\'s pages are citable by the correction')
  assert.equal(result.gate.passed, true, 'cut on the first pass, so no retry was needed')
  assert.equal(stages.calls.verifyClaims, 1)
})

test('a contradicted claim that survives corrections still blocks, whatever the validator says', async () => {
  const contradicted = {
    claim: 'Rogers conceded.', excerpt: SENTENCES.rogers, verdict: 'CONTRADICTED', evidence: 'He did not.', sources: [SOURCE],
  }
  const waive = (_, review) => approve(review.issues.filter(i => i.severity === 'required')
    .map(i => ({ excerpt: i.excerpt, disposition: 'supported', evidenceType: 'verification', evidenceRef: SOURCE, note: '' })))
  const stages = stagesFor({
    drafts: [articleFrom(ALL)],
    reviews: [{ overallScore: 7, issues: [] }],
    // The re-check does not happen to re-extract the claim. It must block anyway.
    verifications: [verificationOf([contradicted]), verificationOf(ALL.filter(k => k !== 'rogers').map(supported))],
    corrections: [changeNothing, changeNothing],
    validations: [waive, waive],
  })

  const result = await processCluster(CLUSTER, '2026-11-04', stages)

  assert.equal(result.gate.passed, false)
  assert.ok(result.gate.blockers.some(b => b.kind === 'CONTRADICTED_CLAIM'))
  assert.ok(excerptStillPresent(SENTENCES.rogers, result.article.body))
})

test('a reviewer flag the fact-check confirmed never reaches corrections', async () => {
  const flag = {
    type: 'UNVERIFIABLE', severity: 'required',
    excerpt: 'the first Muslim elected to the Senate from Michigan',
    correction: 'Not in the source headlines.',
  }
  const stages = stagesFor({
    drafts: [articleFrom(ALL)],
    reviews: [{ overallScore: 7, issues: [flag] }],
    verifications: [verificationOf(ALL.map(k => k === 'first'
      ? { ...supported('first'), claim: 'El-Sayed is the first Muslim elected to the Senate from Michigan.' }
      : supported(k)))],
    corrections: [],
    validations: [() => approve([])],
  })

  const result = await processCluster(CLUSTER, '2026-11-04', stages)

  assert.equal(stages.calls.applyCorrections.length, 0, 'nothing was required, so no correction call was paid for')
  assert.equal(result.gate.passed, true)
  const settled = result.grokReview.issues.find(i => i.excerpt === flag.excerpt)
  assert.equal(settled.severity, 'suggested')
  assert.deepEqual(settled.settledBy.sources, [SOURCE])
})

test('checkArticle keeps a bias flag required however well the passage is sourced', async () => {
  const flag = { type: 'BIASED', severity: 'required', excerpt: 'the first Muslim elected to the Senate from Michigan', correction: 'Framing.' }
  const stages = stagesFor({
    drafts: [], corrections: [], validations: [],
    reviews: [{ overallScore: 7, issues: [flag] }],
    verifications: [verificationOf(ALL.map(supported))],
  })
  const { review } = await checkArticle(articleFrom(ALL), CLUSTER, '2026-11-04', {}, stages)
  assert.equal(review.issues.find(i => i.excerpt === flag.excerpt).severity, 'required')
})

test('a passage already cut cannot fail the article, whatever the validator says of it', async () => {
  const gone = { type: 'UNVERIFIED', severity: 'required', excerpt: SENTENCES.turnout, correction: 'Could not be confirmed.' }
  const stages = stagesFor({
    drafts: [articleFrom(ALL)],
    reviews: [{ overallScore: 7, issues: [gone] }],
    verifications: [verificationOf(ALL.filter(k => k !== 'turnout').map(supported))],
    corrections: [deleteAll],
    // Describes the cut passage as "supported" with nothing behind it. That
    // used to fail the article over a sentence no longer on the page.
    validations: [() => approve([{ excerpt: SENTENCES.turnout, disposition: 'supported', evidenceType: 'none', evidenceRef: '', note: '' }])],
  })

  const result = await processCluster(CLUSTER, '2026-11-04', stages)
  assert.equal(result.gate.passed, true, JSON.stringify(result.gate.blockers.map(b => b.kind)))
})
