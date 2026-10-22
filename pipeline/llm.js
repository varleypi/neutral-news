/**
 * Shared plumbing for talking to Claude.
 *
 * Two things live here that every stage needs and that each stage used to do
 * slightly differently:
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

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8'

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
 * callers see all search results and all text regardless of how many pauses
 * the server took.
 */
async function createWithTools(client, params, { maxLegs = 4 } = {}) {
  const messages = [...params.messages]
  const all = []

  for (let leg = 0; leg < maxLegs; leg++) {
    const response = await client.messages.create({ ...params, messages })
    all.push(...response.content)

    if (response.stop_reason !== 'pause_turn') return { content: all, stopReason: response.stop_reason }

    // Hand the partial turn back verbatim so the server can carry on.
    messages.push({ role: 'assistant', content: response.content })
  }

  return { content: all, stopReason: 'max_legs_reached' }
}

module.exports = {
  MODEL,
  webSearchTool,
  extractJson,
  collectText,
  collectSearchSources,
  collectSearchErrors,
  createWithTools,
}
