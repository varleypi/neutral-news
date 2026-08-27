import test from 'node:test'
import assert from 'node:assert/strict'
import { cdata, escapeXml, rfc822, w3cDate } from './xml.ts'

test('escapeXml escapes every character that would change the markup', () => {
  assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;')
})

test('escapeXml removes control bytes XML 1.0 cannot represent', () => {
  assert.equal(escapeXml('head\u0000\u0007line\u001f'), 'headline')
  // Tab, newline and carriage return are legal and must survive.
  assert.equal(escapeXml('a\tb\nc\rd'), 'a\tb\nc\rd')
})

test('escapeXml removes unpaired surrogates but keeps real astral characters', () => {
  assert.equal(escapeXml('a\ud800b'), 'ab')
  assert.equal(escapeXml('a\udc00\udc00b'), 'ab')
  assert.equal(escapeXml('vote 👍 now'), 'vote 👍 now')
})

test('escapeXml treats null and undefined as empty', () => {
  assert.equal(escapeXml(null), '')
  assert.equal(escapeXml(undefined), '')
})

test('cdata splits the one sequence that would end the section early', () => {
  const wrapped = cdata('before]]>after')
  assert.equal(wrapped, '<![CDATA[before]]]]><![CDATA[>after]]>')
  // Concatenating the sections back together restores the original payload.
  assert.equal(
    wrapped
      .split(/<!\[CDATA\[|]]>/)
      .join(''),
    'before]]>after'
  )
})

test('rfc822 formats a timestamp and rejects an unusable one', () => {
  assert.equal(rfc822('2026-06-03T08:00:00Z'), 'Wed, 03 Jun 2026 08:00:00 GMT')
  assert.equal(rfc822('not a date'), null)
  assert.equal(rfc822(null), null)
  assert.equal(rfc822(''), null)
})

test('w3cDate formats a timestamp and rejects an unusable one', () => {
  assert.equal(w3cDate('2026-06-03T08:00:00Z'), '2026-06-03T08:00:00.000Z')
  assert.equal(w3cDate('not a date'), null)
  assert.equal(w3cDate(undefined), null)
})
