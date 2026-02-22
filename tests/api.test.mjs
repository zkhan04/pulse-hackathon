import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  buildRouteRequest,
  buildRunRequest,
  createApiClient,
  estimateTokensFromChars,
} from '../lib/api.mjs'

const routeFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/route-response.json', import.meta.url), 'utf8'))
const runFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/run-response.json', import.meta.url), 'utf8'))

test('estimateTokensFromChars uses chars/4 ceiling', () => {
  assert.equal(estimateTokensFromChars(0), 0)
  assert.equal(estimateTokensFromChars(1), 1)
  assert.equal(estimateTokensFromChars(4), 1)
  assert.equal(estimateTokensFromChars(5), 2)
})

test('buildRouteRequest shapes metadata-only payload', () => {
  const req = buildRouteRequest({
    requestId: 'req-1',
    timestampMs: 123,
    modelId: 'gpt-5-mini',
    maxTokens: 256,
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ],
  })

  assert.deepEqual(Object.keys(req).sort(), [
    'estimated_prompt_tokens',
    'max_tokens',
    'model_id',
    'prompt_chars',
    'request_id',
    'timestamp_ms',
  ])
  assert.equal(req.request_id, 'req-1')
  assert.equal(req.model_id, 'gpt-5-mini')
  assert.equal(req.prompt_chars, 'You are helpful.'.length + 'Hello'.length)
  assert.equal(req.estimated_prompt_tokens, Math.ceil(req.prompt_chars / 4))
})

test('buildRunRequest shapes full run payload', () => {
  const messages = [{ role: 'user', content: 'Ping' }]
  const req = buildRunRequest({
    requestId: 'req-2',
    timestampMs: 456,
    modelId: 'gpt-5-mini',
    maxTokens: 128,
    messages,
  })

  assert.deepEqual(req, {
    request_id: 'req-2',
    timestamp_ms: 456,
    model_id: 'gpt-5-mini',
    max_tokens: 128,
    messages,
  })
})

test('mock api client returns valid route and run responses', async () => {
  const client = createApiClient({ useMockBackend: true })
  const routeResponse = await client.route({ request_id: 'req-3' })
  const runResponse = await client.run(routeResponse.endpoint, {
    request_id: 'req-3',
    model_id: 'gpt-5-mini',
    messages: [{ role: 'user', content: 'Hello mock' }],
  })

  assert.equal(routeResponse.request_id, 'req-3')
  assert.ok(routeResponse.server_id)
  assert.ok(routeResponse.endpoint)
  assert.equal(runResponse.request_id, 'req-3')
  assert.equal(runResponse.model_id, 'gpt-5-mini')
  assert.equal(runResponse.output.role, 'assistant')
  assert.equal(typeof runResponse.timing.elapsed_ms, 'number')
})

test('fixtures match expected required fields', () => {
  for (const key of ['request_id', 'server_id', 'endpoint', 'reason']) {
    assert.ok(routeFixture[key] !== undefined, `route fixture missing ${key}`)
  }

  for (const key of ['request_id', 'model_id', 'output', 'usage', 'timing']) {
    assert.ok(runFixture[key] !== undefined, `run fixture missing ${key}`)
  }
  assert.equal(runFixture.output.role, 'assistant')
  assert.equal(typeof runFixture.timing.elapsed_ms, 'number')
})