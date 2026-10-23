/**
 * Shared plumbing for talking to Claude.
 *
 * Three things live here that every stage needs and that each stage used to do
 * slightly differently:
 *
 *   • The client itself, configured once. The SDK's defaults — a 10-minute
 *     timeout with two retries — meant a slow call could occupy half an hour
 *     before failing. The 2026-10-19 pilot lost three calls that way.
 *
 *   • JSON extraction. Every stage used `text.match(/\{[\s\S]*\}/)`, which runs
 *     from the first `{` in the response to the last `}` anywhere after it. With
 *     a single tidy JSON reply that works. With a server-tool response — where
 *     the model narrates, searches, and then answers — it happily splices two
 *     unrelated objects together and throws. A parse failure used to mean
 *     "auto-approve", so a sloppy regex was a publication risk.
 *
 *   • The server-tool turn loop. Web search runs on Anthropic's side, and a
 *     response can come back with `stop_reason: "pause_turn"` partway through.
 *     Resuming means handing the assistant's own content back and asking again.
 */

const Anthropic = require('@anthropic-ai/sdk')

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8'

// Per-attempt ceiling. Combined with one retry this bounds a single stage at
// roughly twice this, instead of the SDK default's 30 minutes.
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 8 * 60 * 1000

/**
 * Output budget.
 *
 * This is the fix for the pilot's six "No parseable JSON" failures. Thinking
 * tokens are charged against `max_tokens`, so a stage running adaptive thinking
 * and half a dozen searches on a 4,000-token budget spends the whole allowance
 * reasoning and gets truncated before it writes the JSON the pipeline needs.
 * Every stage returns a small object; the budget is for the thinking in front
 * of it, not the answer.
 */
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS) || 16000

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: TIMEOUT_MS,
  maxRetries: 1,
})

/** The web search tool definition, shared by every stage that retrieves. */
function webSearchTool(maxUses = 6) {
  return { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }
}

/**
 * Pull the last complete JSON object out of a model response.
 *
 * Scans for balanced braces while respecting string literals and escapes, and
 * returns the LAST top-level object — models tend to think out loud first and
 * answer last. Throws rather than returning a default: callers decide what a
 * failure means, and the safe answer is never "ship it".
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
      } else if (depth < 0) {
        depth = 0 // stray brace in prose; resynchronise
      }
    }
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i])
    } catch {
      // Not valid on its own — try the next-outermost candidate.
    }
  }

  throw new Error('No parseable JSON object in model response')
}

/**
 * Parse a stage's reply, naming the real cause when it fails.
 *
 * A truncated response and a malformed one both leave the pipeline without
 * JSON, but they call for different fixes — one is a budget problem, the other
 * a prompting problem. The pilot reported both as "No parseable JSON object",
 * which sent the diagnosis the wrong way.
 */
function parseStageResponse(content, stopReason, stage) {
  try {
    return extractJson(collectText(content))
  } catch (err) {
    if (stopReason === 'max_tokens') {
      throw new Error(
        `${stage} hit the ${MAX_TOKENS}-token output cap before returning JSON — ` +
        `raise CLAUDE_MAX_TOKENS or lower the effort for this stage`
      )
    }
    if (stopReason === 'refusal') throw new Error(`${stage} was declined by the model's safety classifiers`)
    if (stopReason === 'max_legs_reached') throw new Error(`${stage} did not finish its tool turn within the leg limit`)
    throw new Error(`${stage}: ${err.message} (stop_reason: ${stopReason})`)
  }
}

/** Concatenate the text blocks of a response, ignoring thinking and tool blocks. */
function collectText(content = []) {
  return content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
}

/**
 * Every URL the model actually retrieved during this response.
 *
 * These are the only URLs the gate will accept as external evidence, which is
 * what stops a waiver from citing a source the model merely remembers.
 * Server-tool errors arrive as HTTP 200 with an error object in place of the
 * usual result list, so the shape has to be checked before iterating.
 */
function collectSearchSources(content = []) {
  const urls = []
  for (const block of content) {
    if (block.type !== 'web_search_tool_result') continue
    if (!Array.isArray(block.content)) continue // error object, not results
    for (const result of block.content) {
      if (result?.url) urls.push(result.url)
    }
  }
  return [...new Set(urls)]
}

/** Any search errors the API reported in-band, for logging. */
function collectSearchErrors(content = []) {
  return content
    .filter(b => b.type === 'web_search_tool_result' && !Array.isArray(b.content))
    .map(b => b.content?.error_code ?? 'unknown_error')
}

/**
 * Run a request to completion, resuming through `pause_turn`.
 *
 * Returns the accumulated content blocks across every leg of the turn, so
 * callers see all search results and all text regardless of how many pauses the
 * server took, plus the stop reason of the final leg so they can tell a
 * truncated answer from a finished one.
 */
async function createWithTools(params, { maxLegs = 4 } = {}) {
  const messages = [...params.messages]
  const all = []

  for (let leg = 0; leg < maxLegs; leg++) {
    const response = await client.messages.create({ max_tokens: MAX_TOKENS, ...params, messages })
    all.push(...response.content)

    if (response.stop_reason !== 'pause_turn') return { content: all, stopReason: response.stop_reason }

    // Hand the partial turn back verbatim so the server can carry on.
    messages.push({ role: 'assistant', content: response.content })
  }

  return { content: all, stopReason: 'max_legs_reached' }
}

module.exports = {
  MODEL,
  MAX_TOKENS,
  TIMEOUT_MS,
  client,
  webSearchTool,
  extractJson,
  parseStageResponse,
  collectText,
  collectSearchSources,
  collectSearchErrors,
  createWithTools,
}
