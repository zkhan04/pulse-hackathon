import { useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'chat_app_v1'
const ROUTER_URL = process.env.NEXT_PUBLIC_ROUTER_URL || 'http://localhost:8080'
const ROUTE_TIMEOUT_MS = 1000
const RUN_TIMEOUT_MS = 30000
const DEFAULT_MAX_TOKENS = 256

function nowMs() {
  return Date.now()
}

function estimateTokensFromChars(chars) {
  return Math.ceil(chars / 4)
}

function generateRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isAbortError(error) {
  return error?.name === 'AbortError'
}

function isEndpointUnreachable(error) {
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

async function postJson(url, body, { timeoutMs, signal }) {
  const timeout = withTimeoutSignal(timeoutMs, signal)

  try {
    const response = await fetch(url, {
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

function makeChat() {
  const id = Date.now().toString()
  return { id, title: 'New chat', messages: [] }
}

export default function HomePage() {
  const [chats, setChats] = useState([])
  const [currentChatId, setCurrentChatId] = useState(null)
  const [model, setModel] = useState('mock-small')
  const [prompt, setPrompt] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [routeInfo, setRouteInfo] = useState(null)
  const [requestError, setRequestError] = useState('')
  const messagesRef = useRef(null)
  const activeRequestRef = useRef(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed) && parsed.length) {
        setChats(parsed)
        setCurrentChatId(parsed[0].id)
        return
      }
    } catch {}

    const chat = makeChat()
    setChats([chat])
    setCurrentChatId(chat.id)
  }, [])

  useEffect(() => {
    if (chats.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))
    }
  }, [chats])

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [currentChatId, chats])

  useEffect(
    () => () => {
      activeRequestRef.current?.abort()
    },
    [],
  )

  const currentChat = useMemo(
    () => chats.find((chat) => chat.id === currentChatId) ?? null,
    [chats, currentChatId],
  )

  function newChat() {
    const chat = makeChat()
    setChats((prev) => [chat, ...prev])
    setCurrentChatId(chat.id)
    setRequestError('')
    setRouteInfo(null)
  }

  function appendMessageToChat(chatId, role, content) {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat

        const nextMessages = [...chat.messages, { role, content }]
        const nextTitle =
          role === 'user' && (!chat.title || chat.title === 'New chat')
            ? content.slice(0, 30)
            : chat.title

        return { ...chat, title: nextTitle, messages: nextMessages }
      }),
    )
  }

  function replaceThinkingMessage(chatId, replacementContent) {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat

        const msgs = [...chat.messages]
        for (let i = msgs.length - 1; i >= 0; i -= 1) {
          const m = msgs[i]
          if (m.role === 'assistant' && String(m.content).startsWith('... thinking')) {
            msgs.splice(i, 1, { role: 'assistant', content: replacementContent })
            return { ...chat, messages: msgs }
          }
        }

        msgs.push({ role: 'assistant', content: replacementContent })
        return { ...chat, messages: msgs }
      }),
    )
  }

  async function requestRoute(routeRequest, signal) {
    return postJson(`${ROUTER_URL}/route`, routeRequest, {
      timeoutMs: ROUTE_TIMEOUT_MS,
      signal,
    })
  }

  async function requestRun(endpoint, runRequest, signal) {
    return postJson(`${endpoint}/run`, runRequest, {
      timeoutMs: RUN_TIMEOUT_MS,
      signal,
    })
  }

  async function sendPrompt() {
    const text = prompt.trim()
    if (!text || !currentChatId || !currentChat || isSending) return

    const chatId = currentChatId
    const requestId = generateRequestId()
    const timestampMs = nowMs()
    const userMessage = { role: 'user', content: text }
    const nextMessages = [...(currentChat.messages || []), userMessage]
    const promptChars = nextMessages.reduce((sum, m) => sum + String(m.content || '').length, 0)
    const estimatedPromptTokens = estimateTokensFromChars(promptChars)

    setPrompt('')
    setRequestError('')
    setRouteInfo(null)
    setIsSending(true)

    appendMessageToChat(chatId, 'user', text)
    appendMessageToChat(chatId, 'assistant', `... thinking (${model})`)

    const controller = new AbortController()
    activeRequestRef.current = controller

    const routeRequest = {
      request_id: requestId,
      timestamp_ms: timestampMs,
      model_id: model,
      prompt_chars: promptChars,
      estimated_prompt_tokens: estimatedPromptTokens,
      max_tokens: DEFAULT_MAX_TOKENS,
    }

    const runRequest = {
      request_id: requestId,
      timestamp_ms: timestampMs,
      model_id: model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: nextMessages,
    }

    let lastRunError = null

    try {
      let selectedRoute = await requestRoute(routeRequest, controller.signal)

      setRouteInfo({
        requestId,
        serverId: selectedRoute.server_id,
        endpoint: selectedRoute.endpoint,
        reason: selectedRoute.reason,
        elapsedMs: null,
        cached: false,
      })

      for (let runAttempt = 0; runAttempt < 2; runAttempt += 1) {
        const routeForAttempt = runAttempt === 0 ? selectedRoute : await requestRoute(routeRequest, controller.signal)

        if (runAttempt > 0) {
          selectedRoute = routeForAttempt
          setRouteInfo({
            requestId,
            serverId: routeForAttempt.server_id,
            endpoint: routeForAttempt.endpoint,
            reason: `${routeForAttempt.reason} (rerouted after endpoint failure)`,
            elapsedMs: null,
            cached: false,
          })
        }

        try {
          const runResponse = await requestRun(routeForAttempt.endpoint, runRequest, controller.signal)

          replaceThinkingMessage(chatId, runResponse?.output?.content || '(empty response)')
          setRouteInfo({
            requestId,
            serverId: routeForAttempt.server_id,
            endpoint: routeForAttempt.endpoint,
            reason: routeForAttempt.reason,
            elapsedMs: runResponse?.timing?.elapsed_ms ?? null,
            cached: Boolean(runResponse?.cached),
          })
          return
        } catch (error) {
          lastRunError = error
          if (runAttempt === 0 && isEndpointUnreachable(error)) {
            continue
          }
          throw error
        }
      }

      throw lastRunError || new Error('Run failed')
    } catch (error) {
      if (isAbortError(error)) {
        replaceThinkingMessage(chatId, '[Request canceled]')
        setRequestError('Request canceled or timed out')
      } else {
        const detail = error?.payload?.detail || error?.message || 'Request failed'
        replaceThinkingMessage(chatId, `[Error] ${detail}`)
        setRequestError(detail)
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null
      }
      setIsSending(false)
    }
  }

  function cancelActiveRequest() {
    activeRequestRef.current?.abort()
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Chats</h2>
          <button type="button" onClick={newChat}>
            + New
          </button>
        </div>
        <ul className="chat-list">
          {chats.map((chat) => (
            <li
              key={chat.id}
              className={chat.id === currentChatId ? 'active' : ''}
              onClick={() => setCurrentChatId(chat.id)}
            >
              {chat.title || 'Untitled'}
            </li>
          ))}
        </ul>
      </aside>

      <main className="main">
        <header className="main-header">
          <div className="model-select">
            <label htmlFor="modelSelect">Model:</label>
            <select
              id="modelSelect"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isSending}
            >
              <option value="mock-small">mock-small</option>
              <option value="mock-large">mock-large</option>
              <option value="gpt-5-mini">gpt-5-mini</option>
            </select>
          </div>

          <div className="chat-title">{currentChat?.title || 'Select a chat'}</div>

          {routeInfo && (
            <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>
              {routeInfo.serverId}
              {routeInfo.elapsedMs != null ? ` (${routeInfo.elapsedMs}ms)` : ''}
              {routeInfo.cached ? ' cached' : ''}
            </div>
          )}
        </header>

        <section ref={messagesRef} className="messages">
          {currentChat?.messages?.map((m, index) => (
            <div key={`${m.role}-${index}`} className={`message ${m.role}`}>
              {m.content}
            </div>
          ))}
        </section>

        <footer className="composer">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Type a message and press Send"
            disabled={isSending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                sendPrompt()
              }
            }}
          />
          {!isSending ? (
            <button type="button" onClick={sendPrompt}>
              Send
            </button>
          ) : (
            <button type="button" onClick={cancelActiveRequest}>
              Cancel
            </button>
          )}
        </footer>

        {(requestError || routeInfo?.endpoint || routeInfo?.reason) && (
          <div
            style={{
              padding: '8px 12px',
              fontSize: 12,
              color: requestError ? '#fca5a5' : '#94a3b8',
              borderTop: '1px solid rgba(255,255,255,0.03)',
            }}
          >
            {requestError && <div>Error: {requestError}</div>}
            {routeInfo?.requestId && <div>Request ID: {routeInfo.requestId}</div>}
            {routeInfo?.endpoint && <div>Endpoint: {routeInfo.endpoint}</div>}
            {routeInfo?.reason && <div>Route: {routeInfo.reason}</div>}
          </div>
        )}
      </main>
    </div>
  )
}