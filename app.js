const STORAGE_KEY = 'chat_app_v1'

let chats = []
let currentChatId = null

/* --- Helpers --- */
function $(id){return document.getElementById(id)}
function save(){localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))}
function load(){
  const raw = localStorage.getItem(STORAGE_KEY)
  if(raw){
    try{chats = JSON.parse(raw)}catch(e){chats=[]}
  }
}

/* --- Rendering --- */
function renderChatList(){
  const el = $('chatList')
  el.innerHTML = ''
  chats.forEach(c=>{
    const li = document.createElement('li')
    li.textContent = c.title || 'Untitled'
    li.dataset.id = c.id
    if(c.id === currentChatId) li.classList.add('active')
    li.addEventListener('click', ()=>{switchChat(c.id)})
    el.appendChild(li)
  })
}

function renderMessages(){
  const box = $('messages')
  box.innerHTML = ''
  const chat = chats.find(x=>x.id===currentChatId)
  if(!chat) return
  chat.messages.forEach(m=>{
    const d = document.createElement('div')
    d.className = 'message ' + (m.role==='user' ? 'user' : 'assistant')
    d.textContent = m.content
    box.appendChild(d)
  })
  box.scrollTop = box.scrollHeight
  $('chatTitle').textContent = chat.title || 'Chat'
}

/* --- Chat actions --- */
function newChat(){
  const id = Date.now().toString()
  const chat = {id, title: 'New chat', messages: []}
  chats.unshift(chat)
  currentChatId = id
  save()
  renderChatList(); renderMessages()
}

function switchChat(id){
  currentChatId = id
  renderChatList(); renderMessages()
}

function addMessage(role, content){
  const chat = chats.find(x=>x.id===currentChatId)
  if(!chat) return
  chat.messages.push({role, content})
  if(role==='user' && (!chat.title || chat.title==='New chat')){
    chat.title = content.slice(0,30)
  }
  save(); renderChatList(); renderMessages()
}

function sendPrompt(){
  const t = $('promptInput')
  const text = t.value.trim()
  if(!text) return
  addMessage('user', text)
  t.value = ''
  // simulate LLM response based on selected model
  const model = $('modelSelect').value
  const loadingId = Date.now()
  addMessage('assistant', `... thinking (${model})`)
  setTimeout(()=>{
    const chat = chats.find(x=>x.id===currentChatId)
    if(!chat) return
    // replace last assistant placeholder
    for(let i=chat.messages.length-1;i>=0;i--){
      if(chat.messages[i].role==='assistant' && chat.messages[i].content.startsWith('... thinking')){
        chat.messages.splice(i,1)
        break
      }
    }
    const reply = mockReply(model, text)
    chat.messages.push({role:'assistant', content:reply})
    save(); renderChatList(); renderMessages()
  }, 700 + Math.random()*600)
}

function mockReply(model, prompt){
  if(model === 'mock-small') return `(${model}) Echo: ${prompt}`
  if(model === 'mock-large') return `(${model}) Summary: ${prompt.slice(0,80)}${prompt.length>80? '...':''}`
  return `(${model}) Mock reply — you asked: ${prompt}`
}

/* --- Init --- */
function init(){
  load()
  if(!chats.length) newChat()
  // wire events
  $('newChatBtn').addEventListener('click', newChat)
  $('sendBtn').addEventListener('click', sendPrompt)
  $('promptInput').addEventListener('keydown', (e)=>{
    if(e.key==='Enter') sendPrompt()
  })
  renderChatList()
  if(!currentChatId) currentChatId = chats[0] && chats[0].id
  renderMessages()
}

document.addEventListener('DOMContentLoaded', init)
