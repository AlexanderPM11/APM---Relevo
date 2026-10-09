import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, eventLabel } from './Activity'
import { errorMessage, streamChat } from './api'
import { deleteConversation, exportConversation, historyOwner, loadHistory, saveConversation } from './history'
import { PlaygroundIcon as Icon } from './Icon'
import { ModelPicker } from './ModelPicker'
import { ResponseText } from './ResponseText'
import type { Attachment, ChatEntry, Conversation, PlaygroundCatalog } from './types'
import './playground.css'

function blank(): Conversation { return { id: crypto.randomUUID(), title: 'Nueva conversación', updated: Date.now(), entries: [], model: 'auto', keyId: null } }
const prompts = [
  { icon: 'edit' as const, title: 'Dale forma a una idea', detail: 'Redacta con el tono adecuado.', text: 'Redacta un correo breve y amable para proponer una reunión de equipo.' },
  { icon: 'spark' as const, title: 'Resuelve un desafío', detail: 'Piensa en cada paso.', text: 'Ayúdame a planificar una migración de software con dependencias, riesgos y un plan de reversión.' },
  { icon: 'chat' as const, title: 'Entiende algo nuevo', detail: 'Una explicación que se entiende.', text: 'Explícame cómo funciona una API con un ejemplo sencillo.' },
  { icon: 'activity' as const, title: 'Prueba tus modelos', detail: 'Compara cómo responden.', text: 'Escribe una función en Python que elimine duplicados de una lista conservando el orden y explica cómo funciona.' },
]

export function Playground({ catalog, onManageKeys, onRefresh, catalogLoading }: { catalog: PlaygroundCatalog; onManageKeys: () => void; onRefresh: () => void; catalogLoading: boolean; catalogUpdated?: Date | null }) {
  const [params, setParams] = useSearchParams()
  const chatId = params.get('chat')
  const [owner] = useState(historyOwner)
  const [history, setHistory] = useState<Conversation[]>([])
  const historyRef = useRef<Conversation[]>([])
  const [loaded, setLoaded] = useState(false)
  const [chat, setChat] = useState<Conversation>(blank)
  const activeChatId = useRef(chat.id)
  const [manualRequested, setManualRequested] = useState(false)
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [readingImages, setReadingImages] = useState(false)
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [saved, setSaved] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [copied, setCopied] = useState('')
  const controller = useRef<AbortController | null>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const selectedKey = catalog.api_keys.find((key) => key.id === chat.keyId) ?? catalog.api_keys[0]
  const model = chat.model === 'auto' || catalog.models.some((item) => item.id === chat.model) ? chat.model : 'auto'
  const selectedModel = catalog.models.find((item) => item.id === model)
  const vision = model === 'auto' || selectedModel?.capabilities.includes('vision')
  const lastAssistant = [...chat.entries].reverse().find((entry) => entry.role === 'assistant')
  const filteredHistory = history.filter((item) => item.title.toLowerCase().includes(historyQuery.toLowerCase()))

  useEffect(() => {
    let mounted = true
    void loadHistory(owner).then((items) => {
      if (!mounted) return
      historyRef.current = items; setHistory(items); setLoaded(true)
    }).catch(() => { if (mounted) { setStorageError('El navegador no permite guardar el historial. Puedes exportar el chat.'); setLoaded(true) } })
    return () => { mounted = false; controller.current?.abort() }
  }, [owner])

  useEffect(() => {
    if (!loaded || chatId === chat.id) return
    controller.current?.abort()
    const existing = chatId ? historyRef.current.find((item) => item.id === chatId) : undefined
    const next = existing ?? blank()
    activeChatId.current = next.id
    setChat(next); setDraft(''); setImages([]); setError(''); setSaved(Boolean(existing)); follow.current = true
    if (chatId && !existing) setError('Esta conversación no está guardada en este navegador.')
    // The URL selects a saved conversation; live response state remains local to that conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, loaded])

  useEffect(() => {
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight
  }, [chat.entries])

  async function persist(next: Conversation) {
    if (!next.entries.length) return
    const items = [next, ...historyRef.current.filter((item) => item.id !== next.id)].sort((a, b) => b.updated - a.updated)
    historyRef.current = items; setHistory(items)
    try { await saveConversation(owner, next); if (activeChatId.current === next.id) setSaved(true); setStorageError('') }
    catch { setSaved(false); setStorageError('No se pudo guardar el chat en este navegador. Exporta una copia para conservarlo.') }
  }
  function changeModel(value: string) {
    const next = { ...chat, model: value, updated: Date.now() }; setChat(next); void persist(next)
  }
  function newChat() {
    const next = blank(); activeChatId.current = next.id
    setChat(next); setParams({}); setDraft(''); setImages([]); setError(''); setSaved(false); setHistoryOpen(false); follow.current = true; textarea.current?.focus()
  }
  async function removeChat() {
    if (!deleteId) return
    try {
      await deleteConversation(owner, deleteId)
      const next = historyRef.current.filter((item) => item.id !== deleteId)
      historyRef.current = next; setHistory(next)
      if (chat.id === deleteId) newChat()
      setDeleteId(null)
    } catch { setStorageError('No se pudo eliminar esta conversación.') }
  }
  async function addImages(files: FileList | null) {
    if (!files?.length || readingImages) return
    setReadingImages(true); setError('')
    try {
      const chosen = Array.from(files)
      if (chosen.some((file) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))) throw new Error('Adjunta imágenes PNG, JPG, WebP o GIF.')
      if (images.length + chosen.length > 4) throw new Error('Puedes adjuntar hasta cuatro imágenes por mensaje.')
      if (chosen.some((file) => file.size > 5 * 1024 * 1024)) throw new Error('Cada imagen debe pesar como máximo 5 MB.')
      const attachments = await Promise.all(chosen.map((file) => new Promise<Attachment>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, data_url: String(reader.result) })
        reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`))
        reader.readAsDataURL(file)
      })))
      setImages((current) => [...current, ...attachments])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron leer las imágenes.') }
    finally { setReadingImages(false); if (fileInput.current) fileInput.current.value = '' }
  }

  async function send(retry = false) {
    if (controller.current || !selectedKey || readingImages) return
    if (!retry && !draft.trim() && !images.length) return
    if (!retry && images.length && !vision) { setError('Elige Automático o un modelo con visión para enviar estas imágenes.'); return }
    let lastUserIndex = -1
    if (retry) for (let index = chat.entries.length - 1; index >= 0; index--) if (chat.entries[index].role === 'user') { lastUserIndex = index; break }
    let entries = retry ? chat.entries.slice(0, lastUserIndex + 1) : [...chat.entries, { id: crypto.randomUUID(), role: 'user' as const, content: draft.trim(), images }]
    if (!entries.length) return
    if (!vision && entries.some((entry) => entry.images.length)) { setError('Esta conversación contiene imágenes. Elige Automático o un modelo con visión.'); return }
    const responseId = crypto.randomUUID()
    entries = [...entries, { id: responseId, role: 'assistant', content: '', images: [], status: 'pending', events: [] }]
    let current: Conversation = { ...chat, title: chat.entries.length ? chat.title : (draft.trim() || 'Conversación con imágenes').slice(0, 55), updated: Date.now(), entries, model, keyId: selectedKey.id }
    const requestController = new AbortController(); controller.current = requestController
    setSending(true); setError(''); setDraft(''); setImages([]); setSaved(false); follow.current = true
    setChat(current); setParams({ chat: current.id }, { replace: true }); void persist(current)
    function updateResponse(update: (entry: ChatEntry) => ChatEntry) {
      current = { ...current, updated: Date.now(), entries: current.entries.map((entry) => entry.id === responseId ? update(entry) : entry) }
      if (activeChatId.current === current.id) setChat(current)
    }
    try {
      await streamChat({ api_key_id: selectedKey.id, model, messages: entries.filter((entry) => entry.id !== responseId && (entry.role === 'user' || entry.status === 'complete')).map((entry) => ({ role: entry.role, content: entry.images.length ? [...(entry.content ? [{ type: 'text', text: entry.content }] : []), ...entry.images.map((image) => ({ type: 'image_url', image_url: { url: image.data_url } }))] : entry.content })) }, requestController.signal, (event) => {
        updateResponse((entry) => {
          if (event.event === 'delta') {
            const events = entry.events?.some((item) => item.event === 'response_started') ? entry.events : [...(entry.events ?? []), { ...event, event: 'response_started', text: undefined }]
            return { ...entry, content: entry.content + (event.text ?? ''), events }
          }
          if (event.event === 'completed') {
            const completion = event.completion
            return { ...entry, status: 'complete', content: completion?.choices?.[0]?.message?.content ?? entry.content, events: [...(entry.events ?? []), { ...event, completion: undefined }], model: completion?.relevo?.model ?? entry.model, provider: completion?.relevo?.provider ?? entry.provider, attempts: completion?.relevo?.attempts ?? entry.attempts, tokens: completion?.usage?.total_tokens, elapsed_ms: event.elapsed_ms }
          }
          return { ...entry, ...(event.event === 'selected' ? { model: event.model, provider: event.provider_name ?? event.provider, attempts: event.attempt } : {}), events: [...(entry.events ?? []), { ...event, message: event.message ? errorMessage(event.message) : undefined }] }
        })
      })
    } catch (reason) {
      const stopped = requestController.signal.aborted
      const message = stopped ? 'Generación detenida.' : reason instanceof Error ? reason.message : 'No se pudo completar la solicitud.'
      updateResponse((entry) => ({ ...entry, status: stopped ? 'stopped' : 'error', error: message, events: entry.events?.at(-1)?.event === 'error' ? entry.events : [...(entry.events ?? []), { event: stopped ? 'stopped' : 'error', message }] }))
    } finally {
      controller.current = null; setSending(false); await persist(current)
    }
  }

  async function copyEntry(entry: ChatEntry) {
    try { await navigator.clipboard.writeText(entry.content); setCopied(entry.id); setTimeout(() => setCopied(''), 1800) }
    catch { setError('No se pudo copiar. Selecciona el texto para copiarlo manualmente.') }
  }
  const currentEvent = lastAssistant?.events?.at(-1)

  return <section className={`pg-workspace ${historyOpen ? 'history-open' : ''} ${activityOpen ? 'activity-open' : ''}`} aria-label="Playground de modelos">
    {(historyOpen || activityOpen) && <button className="pg-mobile-backdrop" aria-label="Cerrar panel lateral" onClick={() => { setHistoryOpen(false); setActivityOpen(false) }}/ >}
    <aside className="pg-history" aria-label="Historial de conversaciones">
      <div className="pg-history-head"><span className="pg-label">TU ESPACIO</span><button className="pg-icon-button pg-panel-close" onClick={() => setHistoryOpen(false)} aria-label="Cerrar historial"><Icon name="close"/></button></div>
      <button className="pg-new-chat" onClick={newChat} disabled={sending}><Icon name="plus" size={17}/> Nueva conversación</button>
      <label className="pg-history-search"><Icon name="search" size={15}/><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Buscar chats" aria-label="Buscar conversaciones"/></label>
      <span className="pg-history-label">CONVERSACIONES</span>
      <div className="pg-history-list">{!loaded ? <p>Cargando historial…</p> : filteredHistory.length ? filteredHistory.map((item) => <div key={item.id} className={`pg-history-item ${item.id === chat.id ? 'active' : ''}`}><button disabled={sending} onClick={() => { setParams({ chat: item.id }); setHistoryOpen(false) }}><Icon name="chat" size={15}/><span><strong>{item.title}</strong><small>{new Date(item.updated).toLocaleDateString('es', { day: 'numeric', month: 'short' })} · {item.model === 'auto' ? 'Automático' : 'Manual'}</small></span></button><button className="pg-delete-chat" disabled={sending} aria-label={`Eliminar ${item.title}`} onClick={() => setDeleteId(item.id)}><Icon name="trash" size={13}/></button></div>) : <div className="pg-history-empty"><Icon name="history" size={24}/><strong>{historyQuery ? 'Sin coincidencias' : 'Tus ideas tienen un lugar.'}</strong><p>{historyQuery ? 'Busca otro nombre.' : 'Las conversaciones se guardan aquí automáticamente.'}</p></div>}</div>
      {deleteId && <div className="pg-delete-confirm" role="alertdialog" aria-label="Eliminar conversación"><p>¿Eliminar este chat del historial?</p><div><button onClick={() => setDeleteId(null)}>Cancelar</button><button onClick={() => void removeChat()}>Eliminar</button></div></div>}
      <div className="pg-history-foot"><span className="pg-local-dot"/><span>Guardado en este navegador<small>Exporta para llevarte una copia.</small></span></div>
    </aside>
    <div className="pg-chat-space">
      <header className="pg-chat-header"><div className="pg-chat-title"><button className="pg-icon-button pg-history-toggle" onClick={() => { setHistoryOpen(true); setActivityOpen(false) }} aria-label="Abrir historial"><Icon name="history"/></button><div><span className="pg-label">PLAYGROUND</span>{editingTitle ? <input autoFocus aria-label="Nombre de la conversación" defaultValue={chat.title} onBlur={(event) => { const next = { ...chat, title: event.target.value.trim().slice(0, 80) || chat.title, updated: Date.now() }; setChat(next); void persist(next); setEditingTitle(false) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}/ > : <button className="pg-title-button" onClick={() => setEditingTitle(true)} disabled={sending}>{chat.title}<Icon name="edit" size={12}/></button>}</div></div><div className="pg-chat-actions"><span className="pg-save-status">{saved ? <><Icon name="check" size={13}/>Guardado</> : 'Listo para explorar'}</span><button className="pg-icon-button" disabled={!chat.entries.length} onClick={() => exportConversation(chat)} aria-label="Exportar conversación" title="Exportar conversación"><Icon name="download" size={17}/></button><button className="pg-icon-button pg-activity-toggle" onClick={() => { setActivityOpen(!activityOpen); setHistoryOpen(false) }} aria-label="Ver actividad en vivo" aria-expanded={activityOpen}><Icon name="activity" size={18}/></button></div></header>
      <div className="pg-toolbar"><div className="pg-mode-switch" role="group" aria-label="Modo de selección"><button className={model === 'auto' ? 'selected' : ''} disabled={sending} onClick={() => changeModel('auto')}>Automático</button><button className={model !== 'auto' ? 'selected' : ''} disabled={sending || !catalog.models.length} onClick={() => { if (model === 'auto') setManualRequested(true) }}>Manual</button></div><ModelPicker models={catalog.models} value={model} onChange={(value) => { changeModel(value); setManualRequested(false) }} disabled={sending} loading={catalogLoading} onRefresh={onRefresh} openRequested={manualRequested} onOpenHandled={() => setManualRequested(false)}/><label className="pg-key-select"><Icon name="settings" size={15}/><select aria-label="Clave API" value={selectedKey?.id ?? ''} disabled={sending || !catalog.api_keys.length} onChange={(event) => { const next = { ...chat, keyId: Number(event.target.value) }; setChat(next); void persist(next) }}><option value="" disabled>Sin clave activa</option>{catalog.api_keys.map((key) => <option value={key.id} key={key.id}>{key.name}</option>)}</select></label></div>
      <div className="pg-transcript" ref={transcript} onScroll={(event) => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90 }} aria-label="Conversación" role="log" aria-live="off">
        {!chat.entries.length ? <div className="pg-welcome"><div className="pg-welcome-mark"><span>r</span><i/></div><span className="pg-label">UN ESPACIO PARA EXPLORAR</span><h1>Una idea.<br/><em>El modelo adecuado.</em></h1><p>Conversa, crea y resuelve. Elige tu modelo<br className="pg-desktop-break"/> o deja que Relevo encuentre el indicado.</p><div className="pg-prompts">{prompts.map((prompt) => <button key={prompt.title} onClick={() => { setDraft(prompt.text); textarea.current?.focus() }}><Icon name={prompt.icon} size={20}/><strong>{prompt.title}</strong><span>{prompt.detail}</span></button>)}</div><span className="pg-catalog-note"><i/>{catalogLoading ? 'Actualizando modelos…' : `${catalog.models.length} modelos en tu espacio`}</span></div> : <div className="pg-messages">{chat.entries.map((entry) => <article key={entry.id} className={`pg-message ${entry.role}`}><div className="pg-message-avatar">{entry.role === 'assistant' ? 'r' : 'Tú'}</div><div className="pg-message-content"><div className="pg-message-heading"><strong>{entry.role === 'assistant' ? entry.model ?? 'Relevo' : 'Tú'}</strong>{entry.role === 'assistant' && entry.provider && <span>{entry.provider}</span>}</div>{entry.images.length > 0 && <div className="pg-message-images">{entry.images.map((image) => <img src={image.data_url} alt={image.name} key={image.id}/>)}</div>}{entry.content && (entry.role === 'assistant' ? <ResponseText text={entry.content}/> : <p className="pg-user-text">{entry.content}</p>)}{entry.status === 'pending' && !entry.content && <div className="pg-pending"><span className="pg-spinner"/>{entry.events?.length ? eventLabel(entry.events.at(-1)!).title : 'Conectando con Relevo…'}</div>}{entry.status === 'pending' && entry.content && <span className="pg-stream-cursor" aria-hidden="true"/>}{entry.error && <div className="pg-inline-error" role="alert">{entry.error}</div>}{entry.role === 'assistant' && entry.status !== 'pending' && <div className="pg-message-actions">{entry.content && <button onClick={() => void copyEntry(entry)} aria-label="Copiar respuesta"><Icon name={copied === entry.id ? 'check' : 'copy'} size={14}/>{copied === entry.id ? 'Copiado' : 'Copiar'}</button>}{entry.id === lastAssistant?.id && <button disabled={sending} onClick={() => void send(true)}><Icon name="refresh" size={13}/>Volver a generar</button>}{entry.elapsed_ms !== undefined && <span>{(entry.elapsed_ms / 1000).toFixed(1)} s</span>}</div>}</div></article>)}</div>}
      </div>
      <div className="pg-composer-area">
        {!catalog.api_keys.length && !catalogLoading && <div className="pg-setup-notice">Necesitas una clave activa para empezar.<button onClick={onManageKeys}>Crear una clave <Icon name="plus" size={13}/></button></div>}
        {!catalog.models.length && !catalogLoading && <div className="pg-setup-notice">No hay modelos disponibles. Configura un proveedor en Modelos.</div>}
        {error && <div className="pg-error" role="alert"><span>{error}</span><button className="pg-icon-button" onClick={() => setError('')} aria-label="Cerrar aviso"><Icon name="close" size={14}/></button></div>}
        {storageError && <div className="pg-error" role="alert">{storageError}</div>}
        {sending && currentEvent && <div className="pg-composer-status" role="status"><span className="pg-spinner"/>{eventLabel(currentEvent).title}{lastAssistant?.model && <span>· {lastAssistant.model}</span>}</div>}
        <form className="pg-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
          {images.length > 0 && <div className="pg-attachments">{images.map((image) => <div key={image.id}><img src={image.data_url} alt={image.name}/><span>{image.name}</span><button type="button" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))} aria-label={`Quitar ${image.name}`}><Icon name="close" size={12}/></button></div>)}</div>}
          <textarea ref={textarea} value={draft} aria-label="Escribe un mensaje" placeholder="¿Qué tienes en mente?" rows={2} disabled={!selectedKey || sending} onChange={(event) => { setDraft(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(180, event.currentTarget.scrollHeight)}px` }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }}/>
          <div className="pg-composer-bottom"><div><input className="visually-hidden" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple aria-label="Subir imágenes" onChange={(event) => void addImages(event.target.files)}/><button type="button" className="pg-attach-button" disabled={sending || readingImages || images.length >= 4 || !vision} onClick={() => fileInput.current?.click()} aria-label="Adjuntar imágenes"><Icon name="image" size={17}/><span>{readingImages ? 'Cargando…' : 'Adjuntar'}</span></button><span className="pg-vision-hint">{vision ? 'Texto e imágenes' : 'Solo texto'}</span></div>{sending ? <button type="button" className="pg-send-button" aria-label="Detener generación" onClick={() => controller.current?.abort()}><Icon name="stop" size={17}/></button> : <button className="pg-send-button" type="submit" disabled={!selectedKey || !catalog.models.length || readingImages || (!draft.trim() && !images.length)} aria-label="Enviar mensaje"><Icon name="send" size={19}/></button>}</div>
        </form>
        <div className="pg-composer-foot"><span>Relevo puede cometer errores. Revisa las respuestas.</span><span>Enter para enviar · Shift + Enter para nueva línea</span></div>
      </div>
    </div>
    <aside className="pg-activity" aria-label="Actividad de la solicitud"><button className="pg-icon-button pg-panel-close" onClick={() => setActivityOpen(false)} aria-label="Cerrar actividad"><Icon name="close"/></button><Activity entry={lastAssistant} sending={sending}/></aside>
  </section>
}
