const Anthropic = require('@anthropic-ai/sdk')

// Per-attempt ceiling. With one retry this bounds a stage at roughly twice
// this, rather than the SDK default's 10 minutes times three retries - which
// was most of the runtime in the 2026-10-19 pilots.
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 8 * 60 * 1000

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: TIMEOUT_MS,
  maxRetries: 1,
})

const WRITER_MODEL = process.env.CLAUDE_WRITER_MODEL || 'claude-sonnet-5'
// The validator is the publish gate; its approval rate is calibrated on Opus.
const VALIDATOR_MODEL = process.env.CLAUDE_VALIDATOR_MODEL || 'claude-opus-4-8'
// The verifier gathers evidence and judges claims against it. It went Opus ->
// Sonnet -> Haiku, each step measured against the same fixture: the published
// 10/19 SpaceX article, which every one of them marked CONTRADICTED with real
// citations. Haiku gave the fullest account of the three, naming the IPO date,
// the ticker, the offer price and the October share price.
//
// That matters because this stage's cost is almost entirely the search results
// it drags into context - 148,000 input tokens a call - and what multiplies
// those is the model's input rate. Haiku is $0.10/MTok against Opus's $5.00,
// so the same work costs a fiftieth.
//
// The publish decision still belongs to Opus. The validator is unchanged, so
// what is cheap here is finding and weighing evidence, not deciding.
const VERIFIER_MODEL = process.env.CLAUDE_VERIFIER_MODEL || 'claude-haiku-5-5'

// Structured outputs guarantee parseable JSON: without them Sonnet emits raw
// newlines inside the article body string, which JSON.parse rejects.
// Thinking is off because these max_tokens budgets assume no thinking.
async function complete({ model = WRITER_MODEL, system, prompt, maxTokens, schema, stage = 'other' }) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    output_config: { format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  recordUsage(stage, model, response.usage)
  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

// ── Stages that need the live web ────────────────────────────────────────────

// ── What a run costs ────────────────────────────────────────────────
// Nothing recorded token usage, so every statement anyone made about where the
// bill went - including mine - was inferred from how many sources a stage
// retrieved. A run now prints what it actually spent, per stage.

const PRICES = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'grok-4.7': { input: 2, output: 6 },
}

const spend = new Map()

/** Record one call. `usage` is the provider's own usage object. */
function recordUsage(stage, model, usage = {}) {
  const key = `${stage}|${model}`
  const row = spend.get(key) ?? { stage, model, calls: 0, input: 0, output: 0, cached: 0 }
  row.calls += 1
  row.input += usage.input_tokens ?? usage.prompt_tokens ?? 0
  row.output += usage.output_tokens ?? usage.completion_tokens ?? 0
  row.cached += usage.cache_read_input_tokens ?? 0
  spend.set(key, row)
}

function rowCost(r) {
  const p = PRICES[r.model]
  if (!p) return null
  return (r.input / 1e6) * p.input + (r.output / 1e6) * p.output
}

/** Lines for the end of a run, dearest stage first. */
function usageReport() {
  const rows = [...spend.values()].sort((a, b) => (rowCost(b) ?? 0) - (rowCost(a) ?? 0))
  if (rows.length === 0) return ['No model calls recorded']
  const out = ['stage                model             calls      input     output      ~cost']
  let total = 0
  for (const r of rows) {
    const c = rowCost(r)
    if (c !== null) total += c
    out.push(
      r.stage.padEnd(20) + r.model.padEnd(18) +
      String(r.calls).padStart(5) + String(r.input).padStart(11) + String(r.output).padStart(11) +
      (c === null ? '          ?' : ('$' + c.toFixed(2)).padStart(11))
    )
  }
  out.push(`${''.padEnd(38)}${String([...spend.values()].reduce((a, r) => a + r.calls, 0)).padStart(5)}${''.padStart(22)}${('$' + total.toFixed(2)).padStart(11)}`)
  out.push('(estimate: list prices, no discounts or cache pricing applied)')
  return out
}

/** The server-side web search tool. */
function webSearchTool(maxUses) {
  return { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }
}

/**
 * A searching call, with thinking on and output left as text.
 *
 * Two deliberate differences from `complete` above.
 *
 * Thinking is ON. These stages decide something from evidence they have just
 * retrieved rather than transcribing a judgement already made, and the budget
 * here is sized for it.
 *
 * `schema` is optional, and whether to pass one is a judgement per stage. The
 * API accepts `output_config.format` alongside server-side search - that was
 * measured, not assumed. But the probe that measured it asked which ticker
 * SpaceX trades under, watched the model search, and got back
 * `{"ticker":"","listed":false}`: legal, schema-shaped, and wrong. One terse
 * prompt is not proof of a structural problem, and it is not evidence worth
 * betting the fact-checker on either. So stages that transcribe a judgement
 * into a known shape pass a schema and get a guaranteed parse; the verifier,
 * whose answer has to come out of what it just read, keeps room to write its
 * findings down before committing to one, and pays for it with a parse step.
 */
async function completeWithSearch({
  model = VERIFIER_MODEL,
  system,
  prompt,
  maxTokens = 16000,
  maxUses = 8,
  effort,
  schema,
  stage = 'other',
  maxLegs = 4,
}) {
  const outputConfig = { ...(effort ? { effort } : {}), ...(schema ? { format: { type: 'json_schema', schema } } : {}) }
  const params = {
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    tools: [webSearchTool(maxUses)],
    system,
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
  }

  const messages = [{ role: 'user', content: prompt }]
  const all = []

  // Server-side search can return `pause_turn` partway through a turn;
  // resuming means handing the assistant's own content back.
  for (let leg = 0; leg < maxLegs; leg++) {
    const response = await client.messages.create({ ...params, messages })
    recordUsage(stage, model, response.usage)
    all.push(...response.content)
    if (response.stop_reason !== 'pause_turn') {
      return { content: all, stopReason: response.stop_reason, sources: collectSearchSources(all) }
    }
    messages.push({ role: 'assistant', content: response.content })
  }

  return { content: all, stopReason: 'max_legs_reached', sources: collectSearchSources(all) }
}

/**
 * Every URL the model actually retrieved.
 *
 * These are the only URLs the gate accepts as external evidence, which is what
 * stops a waiver citing a source the model merely remembers. Server-tool errors
 * arrive as HTTP 200 with an error object where the result list goes, so the
 * shape is checked before iterating.
 */
function collectSearchSources(content = []) {
  const urls = []
  for (const block of content) {
    if (block.type !== 'web_search_tool_result') continue
    if (!Array.isArray(block.content)) continue // error object, not results
    for (const result of block.content) if (result?.url) urls.push(result.url)
  }
  return [...new Set(urls)]
}

/** Search errors the API reported in-band, for logging. */
function collectSearchErrors(content = []) {
  return content
    .filter(b => b.type === 'web_search_tool_result' && !Array.isArray(b.content))
    .map(b => b.content?.error_code ?? 'unknown_error')
}

function collectText(content = []) {
  return content.filter(b => b.type === 'text').map(b => b.text).join('\n')
}

/**
 * Pull the last complete JSON object out of a free-text response.
 *
 * Only needed where a schema is not in play. Scans for balanced braces while
 * respecting string literals, and returns the LAST top-level object - a model
 * that has been searching tends to think out loud first and answer last, which
 * is what defeated the previous first-brace-to-last-brace regex.
 */
function extractJson(text) {
  const src = String(text ?? '').replace(/```(?:json)?/gi, '')
  const candidates = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        candidates.push(src.slice(start, i + 1))
        start = -1
      } else if (depth < 0) depth = 0 // stray brace in prose; resynchronise
    }
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i])
    } catch {
      // Not valid on its own - try the next-outermost candidate.
    }
  }
  throw new Error('No parseable JSON object in model response')
}

/**
 * Parse a searching stage's reply, naming the real cause when it fails.
 *
 * A truncated response and a malformed one both leave the pipeline without
 * JSON but call for different fixes. The second pilot reported both as "No
 * parseable JSON object", which sent the diagnosis the wrong way for a while.
 */
function parseSearchResponse(content, stopReason, stage) {
  try {
    return extractJson(collectText(content))
  } catch (err) {
    if (stopReason === 'max_tokens') {
      throw new Error(`${stage} hit its output cap before returning JSON - raise maxTokens or lower the effort`)
    }
    if (stopReason === 'refusal') throw new Error(`${stage} was declined by the model's safety classifiers`)
    if (stopReason === 'max_legs_reached') throw new Error(`${stage} did not finish its tool turn within the leg limit`)
    throw new Error(`${stage}: ${err.message} (stop_reason: ${stopReason})`)
  }
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const strings = { type: 'array', items: { type: 'string' } }

function object(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

const ARTICLE_SCHEMA = object({
  headline: { type: 'string' },
  summary: { type: 'string' },
  body: { type: 'string' },
  keyFacts: strings,
  references: strings,
  sourcesUsed: strings,
})

const REVIEW_SCHEMA = object({
  overallScore: { type: 'number' },
  issues: {
    type: 'array',
    items: object({
      type: { type: 'string', enum: ['BIASED', 'UNVERIFIABLE', 'IMBALANCED', 'INACCURATE', 'EDITORIAL'] },
      severity: { type: 'string', enum: ['required', 'suggested'] },
      excerpt: { type: 'string' },
      correction: { type: 'string' },
    }),
  },
  critiqueText: { type: 'string' },
  passesReview: { type: 'boolean' },
})

/**
 * The validator's report.
 *
 * `requiredIssueDispositions` is what the gate reads, and putting it in a
 * schema means the disposition vocabulary is enforced by the API rather than
 * hoped for in a prompt: a waiver cannot arrive with an invented disposition,
 * and `evidenceType` cannot quietly go missing. The gate still checks whether
 * the evidence is real - the schema only guarantees the shape.
 */
const VALIDATION_SCHEMA = object({
  approved: { type: 'boolean' },
  confidenceScore: { type: 'number' },
  neutralityRating: { type: 'string', enum: ['Excellent', 'Good', 'Acceptable', 'Needs Revision'] },
  requiredIssueDispositions: {
    type: 'array',
    items: object({
      excerpt: { type: 'string' },
      disposition: { type: 'string', enum: ['removed', 'corrected', 'supported'] },
      evidenceType: { type: 'string', enum: ['reference', 'verification', 'none'] },
      evidenceRef: { type: 'string' },
      note: { type: 'string' },
    }),
  },
  remainingIssues: strings,
  validationNotes: { type: 'string' },
  reviewedAt: { type: 'string' },
})

/**
 * One resolution per flagged passage - the correction step's whole output.
 *
 * Deliberately NOT an article. Asking for the rewritten article back is what
 * produced the 2026-10-24 edition, where the writer returned the original
 * verbatim twice in a row and one story out of twelve published. The model
 * decides what should happen to each passage; ./corrections.js performs it, so
 * "the flagged text is still there" stops being a possible outcome.
 */
const CORRECTIONS_SCHEMA = object({
  resolutions: {
    type: 'array',
    items: object({
      excerpt: { type: 'string' },
      action: { type: 'string', enum: ['delete', 'replace', 'keep'] },
      replacement: { type: 'string' },
      reference: { type: 'string' },
      reasoning: { type: 'string' },
    }),
  },
})

module.exports = {
  client,
  complete,
  completeWithSearch,
  collectText,
  collectSearchSources,
  collectSearchErrors,
  extractJson,
  parseSearchResponse,
  webSearchTool,
  recordUsage,
  usageReport,
  TIMEOUT_MS,
  WRITER_MODEL,
  VALIDATOR_MODEL,
  VERIFIER_MODEL,
  ARTICLE_SCHEMA,
  REVIEW_SCHEMA,
  VALIDATION_SCHEMA,
  CORRECTIONS_SCHEMA,
}
