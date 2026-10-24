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
// The verifier decides whether a claim is true against freshly retrieved
// sources, and a wrong answer there is how a false fact reaches readers. Same
// argument as the validator, so the same model. Override to trade accuracy for
// spend.
const VERIFIER_MODEL = process.env.CLAUDE_VERIFIER_MODEL || VALIDATOR_MODEL

// Structured outputs guarantee parseable JSON: without them Sonnet emits raw
// newlines inside the article body string, which JSON.parse rejects.
// Thinking is off because these max_tokens budgets assume no thinking.
async function complete({ model = WRITER_MODEL, system, prompt, maxTokens, schema }) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    output_config: { format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

// ── Stages that need the live web ────────────────────────────────────────────

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
  TIMEOUT_MS,
  WRITER_MODEL,
  VALIDATOR_MODEL,
  VERIFIER_MODEL,
  ARTICLE_SCHEMA,
  REVIEW_SCHEMA,
  VALIDATION_SCHEMA,
  CORRECTIONS_SCHEMA,
}
