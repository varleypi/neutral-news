const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-5'

// Sonnet 5 thinks by default; these calls ran thinking-off on Opus 4.8 and
// their max_tokens budgets assume no thinking.
async function complete({ system, prompt, maxTokens }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

module.exports = { complete }
