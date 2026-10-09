import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './styles.css'
import './styles/globals.css'

type ApiKey = { id: number; name: string; prefix: string; owner: string | null; is_active: boolean; requests_per_minute: number }
type CreatedKey = { id: number; name: string; prefix: string; api_key: string }
type Admin = { email: string }
type PlaygroundModel = { id: string; name: string; alias: string | null; provider: string; provider_name: string; capabilities: string[] }
type PlaygroundCatalog = { api_keys: ApiKey[]; models: PlaygroundModel[] }
type ChatEntry = { id: string; role: 'user' | 'assistant'; content: string; images: { name: string; data_url: string }[]; meta?: string }

const TOKEN_SLOT = 'relevo.admin.session'

function useDialogFocus(onClose: () => void, returnFocus?: HTMLElement | null) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]',
    ) ?? [])
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault(); items.at(-1)?.focus()
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault(); items[0]?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const target = returnFocus ?? previous
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (target?.isConnected) target.focus({ preventScroll: true })
      }))
    }
  }, [])
  return dialogRef
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_SLOT)
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(path, { ...init, headers })
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_SLOT)
    window.dispatchEvent(new Event('relevo:session-expired'))
  }
  if (!response.ok) {
    let message = 'No se pudo completar la solicitud.'
    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) {
        const friendlyMessages: Record<string, string> = {
          'No compatible model is currently available': 'El modelo elegido no puede procesar esta solicitud. Prueba con Automático o selecciona otro modelo.',
          'All available models failed': 'Los modelos disponibles no pudieron responder. Prueba con Automático o inténtalo de nuevo en unos segundos.',
        }
        message = friendlyMessages[body.detail] ?? body.detail
      }
    } catch { /* The server may return an empty response. */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function Icon({ name, size = 18 }: { name: 'key' | 'copy' | 'plus' | 'logout' | 'external' | 'check' | 'arrow' | 'shield' | 'code' | 'close' | 'trash' | 'refresh' | 'image'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  const paths: Record<typeof name, React.ReactNode> = {
    key: <><circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 8-8 2 2-2 2 2 2-3 3-2-2-3.5 3.5"/></>,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    code: <><path d="m8 17-5-5 5-5M16 7l5 5-5 5M14 4l-4 16"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
  }
  return <svg {...common}>{paths[name]}</svg>
}

export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_SLOT))
  const [admin, setAdmin] = useState<Admin | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState<CreatedKey | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'keys' | 'connect' | 'examples'>(() => location.pathname.startsWith('/connect') ? 'connect' : location.pathname.startsWith('/playground') ? 'examples' : 'keys')
  const [playgroundCatalog, setPlaygroundCatalog] = useState<PlaygroundCatalog>({ api_keys: [], models: [] })
  const [copied, setCopied] = useState('')
  const [apiBase, setApiBase] = useState(window.location.origin)
  const [apiReady, setApiReady] = useState<boolean | null>(null)
  const dialogReturnFocus = useRef<HTMLElement | null>(null)

  function openCreateDialog(event: React.MouseEvent<HTMLButtonElement>) {
    dialogReturnFocus.current = event.currentTarget
    setCreateOpen(true)
  }

  useLayoutEffect(() => {
    if (!createOpen && dialogReturnFocus.current?.isConnected) {
      dialogReturnFocus.current.focus({ preventScroll: true })
    }
  }, [createOpen])

  useEffect(() => {
    const nextTab = location.pathname.startsWith('/connect') ? 'connect' : location.pathname.startsWith('/playground') ? 'examples' : 'keys'
    setTab(nextTab)
    document.title = location.pathname === '/login' ? 'Acceso · Relevo' : `${nextTab === 'keys' ? 'Claves API' : nextTab === 'connect' ? 'Conectar una app' : 'Playground'} · Relevo`
  }, [location.pathname])

  useEffect(() => {
    if (!token && location.pathname !== '/login') navigate('/login', { replace: true })
    if (token && location.pathname === '/login') navigate('/keys', { replace: true })
  }, [token, location.pathname, navigate])

  useEffect(() => {
    void fetch('/console-config').then(async (response) => {
      if (response.ok) {
        const config = await response.json() as { api_base_url?: string }
        if (config.api_base_url) setApiBase(config.api_base_url.replace(/\/$/, ''))
      }
    }).catch(() => undefined)
    void fetch('/ready').then((response) => setApiReady(response.ok)).catch(() => setApiReady(false))
  }, [])

  const loadKeys = async () => {
    setLoading(true)
    setError('')
    try { setKeys(await request<ApiKey[]>('/admin/api-keys')) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar las claves.') }
    finally { setLoading(false) }
  }

  const loadPlaygroundCatalog = async () => {
    try { setPlaygroundCatalog(await request<PlaygroundCatalog>('/admin/playground/catalog')) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo de modelos.') }
  }

  useEffect(() => {
    if (token) void loadKeys()
  }, [token])

  useEffect(() => {
    if (!token || tab !== 'examples') return
    void loadPlaygroundCatalog()
  }, [token, tab])

  useEffect(() => {
    const expired = () => { setToken(null); setAdmin(null); setError('Tu sesión expiró. Vuelve a iniciar sesión.') }
    window.addEventListener('relevo:session-expired', expired)
    return () => window.removeEventListener('relevo:session-expired', expired)
  }, [])

  const filteredKeys = useMemo(() => keys.filter((key) => `${key.name} ${key.owner ?? ''} ${key.prefix}`.toLowerCase().includes(search.toLowerCase())), [keys, search])
  const activeCount = keys.filter((key) => key.is_active).length

  async function signIn(email: string, password: string) {
    setError('')
    try {
      const result = await request<{ access_token: string }>('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      sessionStorage.setItem(TOKEN_SLOT, result.access_token)
      setToken(result.access_token)
      setAdmin({ email })
      navigate('/keys', { replace: true })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.') }
  }

  function signOut() {
    sessionStorage.removeItem(TOKEN_SLOT)
    setToken(null); setAdmin(null); setKeys([]); setTab('keys'); setNewKey(null)
    setCreateOpen(false); setConfirmRevoke(null); setSearch(''); setError(''); setNotice('')
    navigate('/login', { replace: true })
  }

  async function createKey(values: { name: string; owner: string; requests_per_minute: number }) {
    try {
      const result = await request<CreatedKey>('/admin/api-keys', { method: 'POST', body: JSON.stringify(values) })
      setNewKey(result); setCreateOpen(false); await loadKeys()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear la clave.') }
  }

  async function revokeKey(key: ApiKey) {
    try { await request<void>(`/admin/api-keys/${key.id}`, { method: 'DELETE' }); setConfirmRevoke(null); setNotice(`La clave “${key.name}” quedó revocada.`); await loadKeys() }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo revocar la clave.') }
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); window.setTimeout(() => setCopied(''), 1800) }
    catch { setError('El navegador no permitió copiar. Selecciona y copia el texto manualmente.') }
  }

  if (!token) return <Login onSubmit={signIn} error={error} />

  return <>
    <div className="app-shell" inert={Boolean(createOpen || newKey || confirmRevoke)} aria-hidden={Boolean(createOpen || newKey || confirmRevoke)}>
    <aside className="sidebar" aria-label="Navegación principal">
      <a className="brand" href="#inicio" aria-label="Relevo, inicio"><span className="brand-mark">r</span><span>relevo<span className="brand-period">.</span></span></a>
      <div className="side-label">PLATAFORMA</div>
      <button className={`nav-item ${tab === 'keys' ? 'active' : ''}`} onClick={() => navigate('/keys')}><Icon name="key"/><span>Claves API</span><span className="nav-count">{activeCount}</span></button>
      <button className={`nav-item ${tab === 'connect' ? 'active' : ''}`} onClick={() => navigate('/connect')}><Icon name="code"/><span>Conectar una app</span></button>
      <button className={`nav-item ${tab === 'examples' ? 'active' : ''}`} onClick={() => navigate('/playground')}><Icon name="code"/><span>Ejemplos API</span></button>
      <button className="mobile-logout icon-button subtle" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={signOut}><Icon name="logout" size={17}/></button>
      <div className="sidebar-bottom">
        <div className="status-card"><span className={`status-pulse ${apiReady === false ? 'status-down' : ''}`}/><div><strong>{apiReady === null ? 'Comprobando servicio' : apiReady ? 'Servicio listo' : 'Servicio no listo'}</strong><small>{apiReady ? 'Modelos listos para usar' : 'Revisa conexión y modelos'}</small></div></div>
        <div className="profile"><div className="avatar">{(admin?.email ?? 'A').charAt(0).toUpperCase()}</div><div className="profile-copy"><strong>{admin?.email ?? 'Administrador'}</strong><small>Espacio de trabajo</small></div><button className="icon-button subtle" title="Cerrar sesión" onClick={signOut}><Icon name="logout" size={17}/></button></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>Relevo</span><span className="crumb-slash">/</span><strong>{tab === 'keys' ? 'Claves API' : tab === 'examples' ? 'Ejemplos API' : 'Conectar una app'}</strong></div><div className="topbar-right"><span className={`live-dot ${apiReady === false ? 'status-down' : ''}`}/>{apiReady === null ? 'Comprobando servicio' : apiReady ? 'Servicio listo' : 'Servicio no listo'}</div></header>
      {error && <div className="toast error-toast" role="alert"><span>{error}</span><button onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
      {notice && <div className="toast success-toast" role="status"><Icon name="check" size={16}/><span>{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
      <div className="content-wrap">
        {tab === 'keys' ? <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>GESTIÓN DE ACCESO</div><h1>Tus claves,<br/><em>bajo control.</em></h1><p className="intro">Crea accesos seguros para cada aplicación. Tú decides quién entra y cuándo.</p></div><div className="heading-orbit" aria-hidden="true"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-center"><Icon name="key" size={24}/></div><span className="orbit-spark spark-a"/><span className="orbit-spark spark-b"/></div></section>
          <section className="overview-row"><div className="stat-card"><span className="stat-icon green"><Icon name="key"/></span><div className="stat-value">{keys.length.toString().padStart(2, '0')}</div><div className="stat-caption">Claves creadas</div></div><div className="stat-card"><span className="stat-icon lime"><span className="tiny-pulse"/></span><div className="stat-value">{activeCount.toString().padStart(2, '0')}</div><div className="stat-caption">Accesos activos</div></div><div className="stat-card stat-note"><div className="note-top"><Icon name="shield" size={16}/><span>PROTEGIDAS POR DISEÑO</span></div><p>El secreto completo se muestra una sola vez al crear la clave.</p><button onClick={() => navigate('/connect')}>Cómo conectarse <Icon name="arrow" size={15}/></button></div></section>
          <section className="keys-section"><div className="section-head"><div><div className="section-kicker">ACCESOS DEL ESPACIO</div><h2>Claves API <span className="count-pill">{keys.length}</span></h2></div><button className="primary-button" onClick={openCreateDialog}><Icon name="plus" size={17}/> Nueva clave</button></div>
            <div className="key-toolbar"><div className="search-box"><span className="search-glyph">⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o propietario…" aria-label="Buscar claves"/></div><button className="icon-button refresh-button" onClick={() => void loadKeys()} title="Actualizar" disabled={loading}><Icon name="refresh" size={17}/></button></div>
            <div className="key-list">
              {loading && keys.length === 0 ? <div className="empty-state"><span className="spinner"/><p>Cargando accesos…</p></div> : filteredKeys.length === 0 ? <div className="empty-state"><span className="empty-key"><Icon name="key" size={24}/></span><h3>{search ? 'No encontramos coincidencias' : 'Todavía no hay claves'}</h3><p>{search ? 'Prueba con otro nombre o propietario.' : 'Crea una clave para conectar tu primera aplicación.'}</p>{!search && <button className="text-action" onClick={openCreateDialog}>Crear primera clave <Icon name="arrow" size={15}/></button>}</div> : filteredKeys.map((key, index) => <article className="key-row" key={key.id} style={{ animationDelay: `${index * 45}ms` }}><div className="key-glyph"><Icon name="key" size={18}/></div><div className="key-primary"><strong>{key.name}</strong><span>{key.owner || 'Sin propietario asignado'}</span></div><code className="key-prefix">rlv_{key.prefix}••••••••</code><div className="limit-chip">{key.requests_per_minute}<span>/ min</span></div><div className={`key-state ${key.is_active ? 'is-active' : 'is-revoked'}`}><i/>{key.is_active ? 'Activa' : 'Revocada'}</div>{key.is_active ? <button className="revoke-button" title={`Revocar ${key.name}`} onClick={(event) => { dialogReturnFocus.current = event.currentTarget; setConfirmRevoke(key) }}><Icon name="trash" size={16}/><span>Revocar</span></button> : <span className="revoked-label">Sin acceso</span>}</article>)}
            </div>
            <div className="list-foot"><span>El secreto completo solo se muestra al crear la clave.</span><span><span className="tiny-pulse"/> Secreto visible una sola vez</span></div>
          </section>
        </> : tab === 'connect' ? <ConnectGuide onCopy={copy} copied={copied} apiBase={apiBase} /> : <ApiPlayground catalog={playgroundCatalog} onManageKeys={() => navigate('/keys')} onRefresh={() => void loadPlaygroundCatalog()} />}
        <footer className="page-footer"><span>RELEVO <b>·</b> ACCESO A MODELOS, EN UN SOLO LUGAR</span><a href="/openapi.json" target="_blank" rel="noopener noreferrer">Referencia de API <Icon name="external" size={13}/></a></footer>
      </div>
    </main>
    </div>
    {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} onSubmit={createKey} returnFocus={dialogReturnFocus.current}/>}
    {newKey && <SecretDialog value={newKey.api_key} name={newKey.name} onClose={() => setNewKey(null)} onCopy={() => void copy(newKey.api_key, 'secret')} copied={copied === 'secret'} returnFocus={dialogReturnFocus.current} />}
    {confirmRevoke && <ConfirmDialog keyInfo={confirmRevoke} onClose={() => setConfirmRevoke(null)} onConfirm={() => void revokeKey(confirmRevoke)} returnFocus={dialogReturnFocus.current}/>}
  </>
}

function Login({ onSubmit, error }: { onSubmit: (email: string, password: string) => void; error: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  return <div className="login-screen"><aside className="login-art" aria-label="Información de Relevo"><div className="art-grid"/><div className="login-art-content"><a className="brand light-brand" href="#inicio"><span className="brand-mark">r</span><span>relevo<span className="brand-period">.</span></span></a><div className="art-copy"><div className="eyebrow light-eyebrow"><span className="eyebrow-line"/>UNA SOLA PUERTA. MUCHOS MODELOS.</div><h1>Tu IA.<br/><em>Tu manera.</em></h1><p>Un acceso simple para conectar tus herramientas con los modelos que mueven tus ideas.</p></div><div className="art-bottom"><div className="art-stat"><strong>01</strong><span>API key<br/>por aplicación</span></div><div className="art-stat"><strong>∞</strong><span>Modelos<br/>a tu alcance</span></div><div className="art-star">✳</div></div></div><div className="login-decoration"><div className="decor-line d1"/><div className="decor-line d2"/><div className="decor-circle"/><span className="decor-cross">✳</span></div></aside><main className="login-panel"><div className="login-form-wrap"><div className="login-kicker">PANEL ADMINISTRATIVO</div><h2>Qué bueno<br/>verte de nuevo.</h2><p className="login-lede">Inicia sesión para administrar las conexiones de tu espacio.</p>{error && <div className="form-error" role="alert">{error}</div>}<form onSubmit={(e) => { e.preventDefault(); onSubmit(email, password) }}><label>Correo de administrador<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" required/></label><label>Contraseña<div className="password-wrap"><input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Tu contraseña" required/><button type="button" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Mostrar'}</button></div></label><button className="primary-button login-submit" type="submit">Entrar al panel <Icon name="arrow" size={17}/></button></form><div className="login-hint"><Icon name="shield" size={16}/><span>Solo administradores pueden gestionar claves.</span></div></div><div className="login-foot">© {new Date().getFullYear()} RELEVO <span>·</span> HECHO PARA CONECTAR</div></main></div>
}

function CreateDialog({ onClose, onSubmit, returnFocus }: { onClose: () => void; onSubmit: (values: { name: string; owner: string; requests_per_minute: number }) => void; returnFocus: HTMLElement | null }) {
  const dialogRef = useDialogFocus(onClose, returnFocus)
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [limit, setLimit] = useState('60')
  const [saving, setSaving] = useState(false)
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section ref={dialogRef} className="modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="modal-close" onClick={onClose} aria-label="Cerrar"><Icon name="close"/></button><div className="modal-icon"><Icon name="key" size={21}/></div><div className="modal-kicker">NUEVO ACCESO</div><h2 id="create-title">Una clave por aplicación.</h2><p className="modal-description">Así podrás identificarla y revocarla por separado cuando lo necesites.</p><form onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSubmit({ name: name.trim(), owner: owner.trim(), requests_per_minute: Number(limit) }); setSaving(false) }}><label>Nombre de la aplicación<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. App móvil" maxLength={120} required/></label><label>Propietario <span className="optional">OPCIONAL</span><input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="p. ej. equipo de producto" maxLength={120}/></label><label>Límite de solicitudes por minuto<div className="input-suffix"><input type="number" min="1" max="10000" value={limit} onChange={(e) => setLimit(e.target.value)} required/><span>solicitudes / min</span></div></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving || !name.trim()}>{saving ? 'Creando…' : 'Crear clave'} <Icon name="arrow" size={16}/></button></div></form></section></div>
}

function SecretDialog({ value, name, onClose, onCopy, copied, returnFocus }: { value: string; name: string; onClose: () => void; onCopy: () => void; copied: boolean; returnFocus: HTMLElement | null }) {
  const dialogRef = useDialogFocus(onClose, returnFocus)
  const [revealed, setRevealed] = useState(false)
  return <div className="modal-backdrop"><section ref={dialogRef} className="modal secret-modal" role="dialog" aria-modal="true" aria-labelledby="secret-title"><div className="secret-success"><span className="success-burst">✳</span><span>CLAVE CREADA</span></div><h2 id="secret-title">Guárdala ahora.</h2><p className="modal-description">La clave de <strong>{name}</strong> solo se muestra esta vez. Cópiala y guárdala en un lugar seguro.</p><div className="secret-box"><code>{revealed ? value : `${value.slice(0, 9)}${'•'.repeat(Math.max(0, value.length - 9))}`}</code><button onClick={() => setRevealed(!revealed)}>{revealed ? 'Ocultar' : 'Mostrar'}</button></div><button className="primary-button copy-secret" onClick={onCopy}><Icon name={copied ? 'check' : 'copy'} size={17}/>{copied ? 'Copiada' : 'Copiar clave'}</button><div className="secret-warning"><Icon name="shield" size={16}/><span>Si la pierdes, crea otra clave y revoca esta.</span></div><button className="done-button" onClick={onClose}>Ya la guardé <Icon name="arrow" size={15}/></button></section></div>
}

function ConfirmDialog({ keyInfo, onClose, onConfirm, returnFocus }: { keyInfo: ApiKey; onClose: () => void; onConfirm: () => void; returnFocus: HTMLElement | null }) {
  const dialogRef = useDialogFocus(onClose, returnFocus)
  return <div className="modal-backdrop"><section ref={dialogRef} className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="revoke-title"><div className="revoke-mark"><Icon name="trash" size={20}/></div><h2 id="revoke-title">¿Revocar esta clave?</h2><p className="modal-description"><strong>{keyInfo.name}</strong> perderá acceso a Relevo de inmediato. Las aplicaciones que la usan dejarán de conectar.</p><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Conservar clave</button><button className="danger-button" onClick={onConfirm}>Revocar acceso</button></div></section></div>
}

function ApiPlayground({ catalog, onManageKeys, onRefresh }: { catalog: PlaygroundCatalog; onManageKeys: () => void; onRefresh: () => void }) {
  const [selectedKeyId, setSelectedKeyId] = useState('')
  const [selectedModel, setSelectedModel] = useState('auto')
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<{ name: string; data_url: string }[]>([])
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const imageInput = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const selectedKey = catalog.api_keys.find((key) => String(key.id) === selectedKeyId) ?? catalog.api_keys[0]
  const model = selectedModel === 'auto' || catalog.models.some((item) => item.id === selectedModel) ? selectedModel : 'auto'
  const selectedModelInfo = catalog.models.find((item) => item.id === model)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, sending])

  async function addImages(files: FileList | null) {
    if (!files?.length) return
    setChatError('')
    const chosen = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (chosen.length !== files.length) setChatError('Solo puedes adjuntar archivos de imagen.')
    const room = Math.max(0, 4 - images.length)
    const accepted = chosen.slice(0, room).filter((file) => file.size <= 5 * 1024 * 1024)
    if (chosen.length > room) setChatError('Puedes adjuntar hasta 4 imágenes por mensaje.')
    if (accepted.length !== Math.min(chosen.length, room)) setChatError('Cada imagen debe pesar como máximo 5 MB.')
    try {
      const loaded = await Promise.all(accepted.map((file) => new Promise<{ name: string; data_url: string }>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, data_url: String(reader.result) })
        reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`))
        reader.readAsDataURL(file)
      })))
      setImages((current) => [...current, ...loaded])
    } catch (error) { setChatError(error instanceof Error ? error.message : 'No se pudieron leer las imágenes.') }
    if (imageInput.current) imageInput.current.value = ''
  }

  async function sendMessage(content = draft) {
    const text = content.trim()
    if ((!text && !images.length) || !selectedKey || sending) return
    const userEntry: ChatEntry = { id: crypto.randomUUID(), role: 'user', content: text, images }
    const conversation = [...messages, userEntry]
    setMessages(conversation)
    setDraft('')
    setImages([])
    setChatError('')
    setSending(true)
    const apiMessages = conversation.map((entry) => ({
      role: entry.role,
      content: entry.images.length
        ? [ ...(entry.content ? [{ type: 'text', text: entry.content }] : []), ...entry.images.map((image) => ({ type: 'image_url', image_url: { url: image.data_url } })) ]
        : entry.content,
    }))
    try {
      const completion = await request<{ choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[]; relevo?: { model: string; provider: string; attempts: number } }>('/admin/playground/chat', {
        method: 'POST',
        body: JSON.stringify({ api_key_id: selectedKey.id, model, messages: apiMessages }),
      })
      const rawContent = completion.choices?.[0]?.message?.content
      const answer = typeof rawContent === 'string' ? rawContent : Array.isArray(rawContent) ? rawContent.map((part) => part.text ?? '').join('') : ''
      if (!answer) throw new Error('El modelo respondió sin contenido de texto.')
      const meta = completion.relevo ? `${completion.relevo.model} · ${completion.relevo.provider} · ${completion.relevo.attempts} ${completion.relevo.attempts === 1 ? 'intento' : 'intentos'}` : undefined
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', content: answer, images: [], meta }])
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'No se pudo completar la solicitud.')
    } finally { setSending(false) }
  }

  return <>
    <section className="page-heading playground-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>CHAT DE PRUEBA</div><h1>Habla con<br/><em>tus modelos.</em></h1><p className="intro">Prueba la API de Relevo en una conversación real, con texto e imágenes.</p></div><div className="playground-orbit" aria-hidden="true"><span>AI</span><i/><i/><i/></div></section>
    <section className="playground-panel chat-playground">
      <div className="playground-panel-head chat-panel-head"><div><span className="section-kicker">TU ESPACIO DE PRUEBAS</span><h2>Chat API</h2></div><div className="chat-head-actions"><span className="available-count"><i/>{catalog.models.length} {catalog.models.length === 1 ? 'modelo' : 'modelos'}</span><button className="secondary-button new-chat-button" onClick={() => { setMessages([]); setImages([]); setDraft(''); setChatError('') }}>Nueva conversación</button></div></div>
      <div className="playground-controls chat-controls">
        <label className="playground-field"><span>Clave API</span><select aria-label="Clave API" value={selectedKey?.id ?? ''} onChange={(event) => setSelectedKeyId(event.target.value)} disabled={!catalog.api_keys.length}><option value="" disabled>{catalog.api_keys.length ? 'Selecciona una clave' : 'No hay claves activas'}</option>{catalog.api_keys.map((key) => <option key={key.id} value={key.id}>{key.name} · rlv_{key.prefix}</option>)}</select></label>
        <label className="playground-field"><span>Modelo</span><select aria-label="Modelo" value={model} onChange={(event) => setSelectedModel(event.target.value)}><option value="auto">Automático · reintenta con otros modelos</option>{catalog.models.map((item) => <option key={`${item.provider}-${item.id}`} value={item.id}>{item.id} · {item.provider_name}{item.capabilities.includes('vision') ? ' · visión' : ''}</option>)}</select><small>{model === 'auto' ? 'Con imágenes, el enrutador prioriza modelos compatibles con visión.' : selectedModelInfo?.capabilities.includes('vision') ? 'Este modelo admite imágenes.' : 'Este modelo no admite imágenes; usa Automático o elige uno con visión.'}</small></label>
        <button className="icon-button chat-refresh" onClick={onRefresh} title="Actualizar modelos" aria-label="Actualizar modelos"><Icon name="refresh" size={17}/></button>
      </div>
      {!catalog.api_keys.length && <div className="playground-empty chat-empty-warning"><span>Crea una clave para atribuir esta conversación a una aplicación y aplicar sus límites.</span><button className="text-action" onClick={onManageKeys}>Crear una clave <Icon name="arrow" size={15}/></button></div>}
      {!catalog.models.length && <div className="playground-empty chat-empty-warning"><span>No hay modelos disponibles. Configura una credencial de proveedor y habilita modelos.</span></div>}
      <div className="chat-transcript" role="log" aria-live="polite" aria-label="Conversación con el modelo">
        {!messages.length && <div className="chat-welcome"><span className="chat-welcome-mark">r</span><h3>¿Qué te gustaría explorar?</h3><p>La conversación se enviará a través de tu API de Relevo. Prueba un modelo o deja que el enrutador elija.</p><div className="prompt-suggestions">{['Resume una idea en tres puntos', '¿Qué puedes hacer con una imagen?', 'Explícame un concepto de forma sencilla'].map((prompt) => <button key={prompt} onClick={() => setDraft(prompt)}>{prompt}<Icon name="arrow" size={14}/></button>)}</div></div>}
        {messages.map((entry) => <article className={`chat-message ${entry.role}`} key={entry.id}><div className="chat-avatar">{entry.role === 'assistant' ? 'r' : 'TÚ'}</div><div className="chat-message-body"><div className="chat-message-name">{entry.role === 'assistant' ? 'Relevo' : 'Tú'}</div>{entry.images.map((image) => <img className="chat-image" key={image.data_url.slice(0, 48)} src={image.data_url} alt={image.name}/>)}{entry.content && <p>{entry.content}</p>}{entry.meta && <small className="chat-meta">{entry.meta}</small>}</div></article>)}
        {sending && <article className="chat-message assistant"><div className="chat-avatar">r</div><div className="chat-message-body"><div className="chat-message-name">Relevo</div><div className="typing-indicator" aria-label="El modelo está respondiendo"><i/><i/><i/></div></div></article>}
        <div ref={bottomRef}/>
      </div>
      {chatError && <div className="chat-error" role="alert">{chatError}</div>}
      {images.length > 0 && <div className="image-attachments" aria-label="Imágenes adjuntas">{images.map((image, index) => <div className="image-attachment" key={image.data_url.slice(0, 48)}><img src={image.data_url} alt={image.name}/><span title={image.name}>{image.name}</span><button onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Quitar ${image.name}`}><Icon name="close" size={14}/></button></div>)}</div>}
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}><input ref={imageInput} className="visually-hidden" type="file" accept="image/*" multiple aria-label="Subir imágenes" onChange={(event) => void addImages(event.currentTarget.files)}/><button type="button" className="icon-button attach-button" onClick={() => imageInput.current?.click()} title="Adjuntar imágenes" aria-label="Adjuntar imágenes" disabled={sending || images.length >= 4}><Icon name="image" size={19}/></button><textarea aria-label="Escribe un mensaje" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} placeholder={selectedKey ? 'Escribe tu mensaje… (Enter para enviar, Shift + Enter para nueva línea)' : 'Crea una clave API para empezar'} rows={2} disabled={!selectedKey || sending}/><button className="send-chat-button" type="submit" aria-label="Enviar mensaje" disabled={!selectedKey || sending || (!draft.trim() && !images.length)}><Icon name="arrow" size={18}/></button></form>
      <div className="chat-footnote"><span><Icon name="shield" size={14}/> Tu clave no se revela al navegador y se respetan sus límites.</span><span>Imágenes: máx. 5 MB cada una · 4 por mensaje</span></div>
    </section>
    <section className="playground-models"><div className="playground-models-title"><div><span className="section-kicker">CATÁLOGO ENRUTABLE</span><h2>Modelos disponibles</h2></div><span className="catalog-refresh-label">Actualizado al entrar en esta pestaña</span></div>{catalog.models.length ? <div className="model-chip-list">{catalog.models.map((item) => <span className="model-chip" key={`${item.provider}-${item.id}`}><i/>{item.id}{item.capabilities.includes('vision') && <span className="model-capability">Visión</span>}<small>{item.provider_name}</small></span>)}</div> : <p className="catalog-empty">Configura una credencial de proveedor y habilita sus modelos para que aparezcan aquí.</p>}</section>
  </>
}
function ConnectGuide({ onCopy, copied, apiBase }: { onCopy: (text: string, label: string) => void; copied: string; apiBase: string }) {
  const [language, setLanguage] = useState<'curl' | 'javascript' | 'python'>('curl')
  const endpoint = `${apiBase}/v1`
  const samples = {
    curl: `curl ${endpoint}/chat/completions -H 'Authorization: Bearer <RELEVO_API_KEY>' -H 'Content-Type: application/json' -d '{"model":"auto","messages":[{"role":"user","content":"Hola"}]}'`,
    javascript: [
      `const response = await fetch('${endpoint}/chat/completions', {`,
      "  method: 'POST',",
      '  headers: {',
      "    'Authorization': 'Bearer ' + process.env.RELEVO_API_KEY,",
      "    'Content-Type': 'application/json',",
      '  },',
      '  body: JSON.stringify({',
      "    model: 'auto',",
      "    messages: [{ role: 'user', content: 'Hola' }],",
      '  }),',
      '});',
      'const result = await response.json();',
    ].join('\n'),
    python: [
      'import os',
      'from openai import OpenAI',
      '',
      'client = OpenAI(',
      `    base_url="${endpoint}",`,
      '    api_key=os.environ["RELEVO_API_KEY"],',
      ')',
      '',
      'response = client.chat.completions.create(',
      '    model="auto",',
      '    messages=[{"role": "user", "content": "Hola"}],',
      ')',
      'print(response.choices[0].message.content)',
    ].join('\n'),
  }
  return <>
    <section className="page-heading connect-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>INTEGRACIÓN</div><h1>Una API.<br/><em>Tus aplicaciones.</em></h1><p className="intro">Conecta cualquier herramienta compatible con OpenAI. Usa una clave distinta por aplicación.</p></div><div className="connect-illustration"><div className="connect-node node-app"><Icon name="code" size={19}/><span>TU APP</span></div><div className="connect-path"><i/><i/><i/></div><div className="connect-node node-relevo"><span className="node-r">r</span><span>RELEVO</span></div></div></section>
    <div className="connect-grid"><section className="guide-main"><div className="guide-card"><div className="guide-title"><div><span className="section-kicker">EMPIEZA EN UN MINUTO</span><h2>Haz tu primera llamada</h2></div><span className="guide-step">01 <i>/ 03</i></span></div><p className="guide-copy">Guarda tu clave como <code>RELEVO_API_KEY</code> en las variables de entorno de tu aplicación. Luego envía una solicitud:</p><div className="code-window"><div className="code-top"><div className="code-lights"><i/><i/><i/></div><div className="code-tabs">{(['curl', 'javascript', 'python'] as const).map((item) => <button key={item} className={language === item ? 'selected' : ''} onClick={() => setLanguage(item)}>{item === 'javascript' ? 'Node.js' : item === 'python' ? 'Python' : 'cURL'}</button>)}</div><button className="code-copy" onClick={() => void onCopy(samples[language], 'snippet')}><Icon name={copied === 'snippet' ? 'check' : 'copy'} size={14}/>{copied === 'snippet' ? 'Copiado' : 'Copiar'}</button></div><pre><code>{samples[language]}</code></pre></div><div className="response-meta"><span className="method-pill">POST</span><code>/v1/chat/completions</code><button onClick={() => void onCopy(`${endpoint}/chat/completions`, 'endpoint')}>{copied === 'endpoint' ? 'Copiado' : 'Copiar URL'}</button></div></div>
      <div className="steps-row"><article><span>01</span><div><strong>Crea una clave</strong><p>Asigna un nombre que reconozcas.</p></div></article><article><span>02</span><div><strong>Guárdala como secreto</strong><p>Usa variables de entorno.</p></div></article><article><span>03</span><div><strong>Envía tu solicitud</strong><p>Relevo selecciona el modelo.</p></div></article></div>
    </section><aside className="guide-aside" aria-label="Recomendaciones de seguridad"><div className="aside-label"><Icon name="shield" size={16}/> RECOMENDADO</div><h3>Protege tu acceso</h3><ul><li><span className="bullet-check"><Icon name="check" size={12}/></span><span>Una clave diferente para cada aplicación.</span></li><li><span className="bullet-check"><Icon name="check" size={12}/></span><span>Guárdala en el servidor, nunca en el navegador.</span></li><li><span className="bullet-check"><Icon name="check" size={12}/></span><span>Revoca el acceso si una clave se expone.</span></li></ul><div className="aside-divider"/><span className="aside-label">URL BASE</span><div className="base-url"><code>{endpoint}</code><button className="icon-button" onClick={() => void onCopy(endpoint, 'base')} title="Copiar URL base"><Icon name={copied === 'base' ? 'check' : 'copy'} size={15}/></button></div><p className="compat-note"><span className="compat-mark">↗</span> Compatible con clientes OpenAI y llamadas HTTP estándar.</p><a className="docs-link" href="/openapi.json" target="_blank" rel="noopener noreferrer">Ver referencia de API <Icon name="external" size={14}/></a></aside></div>
  </>
}

