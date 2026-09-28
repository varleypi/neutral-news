const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const WRITER_MODEL = 'claude-sonnet-5'
// The validator is the publish gate; its approval rate is calibrated on Opus.
const VALIDATOR_MODEL = 'claude-opus-4-8'

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

const VALIDATION_SCHEMA = object({
  approved: { type: 'boolean' },
  confidenceScore: { type: 'number' },
  neutralityRating: { type: 'string', enum: ['Excellent', 'Good', 'Acceptable', 'Needs Revision'] },
  remainingIssues: strings,
  validationNotes: { type: 'string' },
  reviewedAt: { type: 'string' },
})

module.exports = { complete, VALIDATOR_MODEL, ARTICLE_SCHEMA, REVIEW_SCHEMA, VALIDATION_SCHEMA }
