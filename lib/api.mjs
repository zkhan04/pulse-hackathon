export const ROUTE_TIMEOUT_MS = 1000
export const RUN_TIMEOUT_MS = 30000
export const DEFAULT_MAX_TOKENS = 256

export function nowMs() {
  return Date.now()
}

export function estimateTokensFromChars(chars) {
  return Math.ceil(Number(chars || 0) / 4)
}

export function createRequestId() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function buildRouteRequest({ requestId, timestampMs, modelId, messages, maxTokens = DEFAULT_MAX_TOKENS }) {
  const promptChars = (messages || []).reduce(
    (sum, m) => sum + String(m?.content || '').length,
    0,
  )

  return {
    request_id: requestId,
    timestamp_ms: timestampMs,
    model_id: modelId,
    prompt_chars: promptChars,
    estimated_prompt_tokens: estimateTokensFromChars(promptChars),
    max_tokens: maxTokens,
  }
}

export function buildRunRequest({ requestId, timestampMs, modelId, messages, maxTokens = DEFAULT_MAX_TOKENS }) {
  return {
    request_id: requestId,
    timestamp_ms: timestampMs,
    model_id: modelId,
    max_tokens: maxTokens,
    messages,
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError'
}

export function isEndpointUnreachable(error) {
  if (!error || isAbortError(error)) return false
  return error.name === 'TypeError' || String(error.message || '').includes('Failed to fetch')
}

function withTimeoutSignal(ms, parentSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)

  const onAbort = () => controller.abort()
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort()
    } else {
      parentSignal.addEventListener('abort', onAbort, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (parentSignal) parentSignal.removeEventListener('abort', onAbort)
    },
  }
}

async function postJson(url, body, { timeoutMs, signal, fetchImpl = fetch }) {
  const timeout = withTimeoutSignal(timeoutMs, signal)

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeout.signal,
    })

    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }

    if (!response.ok) {
      const detail = data?.detail || data?.error || `HTTP_${response.status}`
      const error = new Error(detail)
      error.status = response.status
      error.payload = data
      throw error
    }

    return data
  } finally {
    timeout.cleanup()
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }

    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export function createMockBackend() {
  return {
    async route(routeRequest, { signal } = {}) {
      await delay(120, signal)
      return {
        request_id: routeRequest.request_id,
        server_id: 'mock-compute-1',
        endpoint: 'http://mock-compute.local:8081',
        reason: 'mock_least_in_flight',
      }
    },
    async run(endpoint, runRequest, { signal } = {}) {
      await delay(350, signal)
      const userText = runRequest.messages?.[runRequest.messages.length - 1]?.content || ''
      return {
        request_id: runRequest.request_id,
        model_id: runRequest.model_id,
        output: {
          role: 'assistant',
          content: `(mock:${runRequest.model_id}) ${String(userText).slice(0, 160)}`,
        },
        usage: {
          prompt_tokens: estimateTokensFromChars(
            (runRequest.messages || []).reduce((sum, m) => sum + String(m?.content || '').length, 0),
          ),
          completion_tokens: estimateTokensFromChars(String(userText).slice(0, 160).length + 10),
          total_tokens: null,
        },
        timing: {
          elapsed_ms: 350,
        },
      }
    },
  }
}

export function createApiClient({ routerUrl, useMockBackend = false, fetchImpl } = {}) {
  const mock = useMockBackend ? createMockBackend() : null

  return {
    useMockBackend,
    async route(routeRequest, { signal } = {}) {
      if (mock) return mock.route(routeRequest, { signal })
      return postJson(`${routerUrl}/route`, routeRequest, {
        timeoutMs: ROUTE_TIMEOUT_MS,
        signal,
        fetchImpl,
      })
    },
    async run(endpoint, runRequest, { signal } = {}) {
      if (mock) return mock.run(endpoint, runRequest, { signal })
      return postJson(`${endpoint}/run`, runRequest, {
        timeoutMs: RUN_TIMEOUT_MS,
        signal,
        fetchImpl,
      })
    },
  }
}