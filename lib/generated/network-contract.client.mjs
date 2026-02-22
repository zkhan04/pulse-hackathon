/**
 * Generated-style client from Network Contract v0 (OpenAPI 3.0.3).
 * JS runtime with JSDoc typing against ./network-contract.types.d.ts
 */

/** @typedef {import('./network-contract.types').RegisterRequest} RegisterRequest */
/** @typedef {import('./network-contract.types').HeartbeatRequest} HeartbeatRequest */
/** @typedef {import('./network-contract.types').RouteRequest} RouteRequest */
/** @typedef {import('./network-contract.types').RouteResponse} RouteResponse */
/** @typedef {import('./network-contract.types').RunRequest} RunRequest */
/** @typedef {import('./network-contract.types').RunResponse} RunResponse */
/** @typedef {import('./network-contract.types').OkResponse} OkResponse */
/** @typedef {import('./network-contract.types').NetworkContractClientOptions} NetworkContractClientOptions */

export class ApiError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status ?? null
    this.payload = payload ?? null
  }
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/$/, '')}${path}`
}

async function postJson(url, body, fetchImpl, { signal } = {}) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    throw new ApiError(data?.detail || data?.error || `HTTP_${response.status}`, {
      status: response.status,
      payload: data,
    })
  }

  return data
}

/**
 * @param {NetworkContractClientOptions} [options]
 */
export function createNetworkContractClient(options = {}) {
  const routerBaseUrl = options.routerBaseUrl || 'http://localhost:8080'
  const fetchImpl = options.fetchImpl || fetch

  return {
    /** @param {RegisterRequest} body @param {{signal?: AbortSignal}} [requestOptions] @returns {Promise<OkResponse>} */
    registerCompute(body, requestOptions) {
      return postJson(joinUrl(routerBaseUrl, '/register'), body, fetchImpl, requestOptions)
    },

    /** @param {HeartbeatRequest} body @param {{signal?: AbortSignal}} [requestOptions] @returns {Promise<OkResponse>} */
    heartbeat(body, requestOptions) {
      return postJson(joinUrl(routerBaseUrl, '/heartbeat'), body, fetchImpl, requestOptions)
    },

    /** @param {RouteRequest} body @param {{signal?: AbortSignal}} [requestOptions] @returns {Promise<RouteResponse>} */
    routeRequest(body, requestOptions) {
      return postJson(joinUrl(routerBaseUrl, '/route'), body, fetchImpl, requestOptions)
    },

    /** @param {string} computeBaseUrl @param {RunRequest} body @param {{signal?: AbortSignal}} [requestOptions] @returns {Promise<RunResponse>} */
    runCompletion(computeBaseUrl, body, requestOptions) {
      return postJson(joinUrl(computeBaseUrl, '/run'), body, fetchImpl, requestOptions)
    },
  }
}