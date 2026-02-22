import { useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'chat_app_v1'

function mockReply(model, prompt) {
  if (model === 'mock-small') return `(${model}) Echo: ${prompt}`
  if (model === 'mock-large') {
    return `(${model}) Summary: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`
  }
  return `(${model}) Mock reply - you asked: ${prompt}`
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
  const messagesRef = useRef(null)

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

  const currentChat = useMemo(
    () => chats.find((chat) => chat.id === currentChatId) ?? null,
    [chats, currentChatId],
  )

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [currentChat?.messages?.length])

  function newChat() {
    const chat = makeChat()
    setChats((prev) => [chat, ...prev])
    setCurrentChatId(chat.id)
  }

  function addMessage(role, content) {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== currentChatId) return chat
        const nextMessages = [...chat.messages, { role, content }]
        const nextTitle = role === 'user' && (!chat.title || chat.title === 'New chat')
          ? content.slice(0, 30)
          : chat.title
        return { ...chat, title: nextTitle, messages: nextMessages }
      }),
    )
  }

  function sendPrompt() {
    const text = prompt.trim()
    if (!text || !currentChatId) return

    addMessage('user', text)
    setPrompt('')
    addMessage('assistant', `... thinking (${model})`)

    setTimeout(() => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== currentChatId) return chat
          const msgs = [...chat.messages]
          for (let i = msgs.length - 1; i >= 0; i -= 1) {
            const m = msgs[i]
            if (m.role === 'assistant' && String(m.content).startsWith('... thinking')) {
              msgs.splice(i, 1)
              break
            }
          }
          msgs.push({ role: 'assistant', content: mockReply(model, text) })
          return { ...chat, messages: msgs }
        }),
      )
    }, 700 + Math.random() * 600)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Chats</h2>
          <button type="button" onClick={newChat}>+ New</button>
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
            <select id="modelSelect" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="mock-small">mock-small</option>
              <option value="mock-large">mock-large</option>
              <option value="gpt-5-mini">gpt-5-mini</option>
            </select>
          </div>
          <div className="chat-title">{currentChat?.title || 'Select a chat'}</div>
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                sendPrompt()
              }
            }}
          />
          <button type="button" onClick={sendPrompt}>Send</button>
        </footer>
      </main>
    </div>
  )
}
