import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './styles.css'
import './styles/globals.css'
import './theme.css'
import { RoutingModels } from './routing-models'
import { Playground } from './features/playground/Playground'

type ApiKey = { id: number; name: string; prefix: string; owner: string | null; is_active: boolean; requests_per_minute: number }
type CreatedKey = { id: number; name: string; prefix: string; api_key: string }
type Admin = { email: string }
type PlaygroundModel = { id: string; name: string; alias: string | null; provider: string; provider_name: string; capabilities: string[] }
type PlaygroundCatalog = { api_keys: ApiKey[]; models: PlaygroundModel[] }

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
          'Invalid email or password': 'El correo o la contraseña no son válidos.',
          'Invalid or expired administrator token': 'Tu sesión expiró. Vuelve a iniciar sesión.',
        }
        message = friendlyMessages[body.detail] ?? body.detail
      }
    } catch { /* The server may return an empty response. */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function Icon({ name, size = 18 }: { name: 'key' | 'copy' | 'plus' | 'logout' | 'external' | 'check' | 'arrow' | 'shield' | 'code' | 'close' | 'trash' | 'refresh' | 'image' | 'sun' | 'moon' | 'search' | 'home'; size?: number }) {
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
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></>,
  }
  return <svg {...common}>{paths[name]}</svg>
}

export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_SLOT))
  const [signingIn, setSigningIn] = useState(false)
  const [admin, setAdmin] = useState<Admin | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState<CreatedKey | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'summary' | 'keys' | 'connect' | 'examples' | 'models'>(() => location.pathname === '/' ? 'summary' : location.pathname.startsWith('/connect') ? 'connect' : location.pathname.startsWith('/playground') ? 'examples' : location.pathname.startsWith('/models') ? 'models' : 'keys')
  const [playgroundCatalog, setPlaygroundCatalog] = useState<PlaygroundCatalog>({ api_keys: [], models: [] })
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogUpdated, setCatalogUpdated] = useState<Date | null>(null)
  const [copied, setCopied] = useState('')
  const [apiBase, setApiBase] = useState(window.location.origin)
  const [readyInfo, setReadyInfo] = useState<{ database: string; models: string } | null>(null)
  const [readyState, setReadyState] = useState<'checking' | 'operational' | 'down'>('checking')
  const [lastReadyCheck, setLastReadyCheck] = useState<Date | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('relevo.console.theme') === 'dark' || (!localStorage.getItem('relevo.console.theme') && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [revokingId, setRevokingId] = useState<number | null>(null)
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
    const nextTab = location.pathname === '/' ? 'summary' : location.pathname.startsWith('/connect') ? 'connect' : location.pathname.startsWith('/playground') ? 'examples' : location.pathname.startsWith('/models') ? 'models' : 'keys'
    setTab(nextTab)
    document.title = location.pathname === '/login' ? 'Acceso · Relevo' : `${nextTab === 'summary' ? 'Resumen' : nextTab === 'keys' ? 'Claves API' : nextTab === 'connect' ? 'Conectar una app' : nextTab === 'models' ? 'Modelos' : 'Playground'} · Relevo`
  }, [location.pathname])

  useEffect(() => {
    if (!token && location.pathname !== '/login') navigate('/login', { replace: true })
    if (token && location.pathname === '/login') navigate('/', { replace: true })
  }, [token, location.pathname, navigate])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('relevo.console.theme', theme)
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#020617' : '#f8fafc')
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!favicon) { favicon = document.createElement('link'); favicon.rel = 'icon'; document.head.append(favicon) }
    const mark = theme === 'dark' ? '#818cf8' : '#4f46e5'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="12" fill="${mark}"/><path d="M27 11c-2-2-5-3-8-2-6 1-9 6-8 12 1 7 6 10 13 8 2-1 4-2 5-4l-4-2c-1 2-3 3-5 3-3 0-5-2-5-5h14c1-4 0-8-2-10Zm-11 6c1-3 5-4 7-2 1 1 2 2 2 3H16Z" fill="#ffffff"/></svg>`
    favicon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
  }, [theme])

  const checkReady = async (signal?: AbortSignal) => {
    setReadyState('checking')
    try {
      const response = await fetch('/ready', { signal, cache: 'no-store' })
      const payload = response.ok ? await response.json() as { database?: string; models?: string } : null
      setReadyInfo(payload ? { database: payload.database ?? 'unknown', models: payload.models ?? 'unknown' } : null)
      setReadyState(response.ok ? 'operational' : 'down')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setReadyInfo(null); setReadyState('down')
    } finally { setLastReadyCheck(new Date()) }
  }

  useEffect(() => {
    const controller = new AbortController()
    void checkReady(controller.signal)
    const refresh = () => { if (document.visibilityState === 'visible') void checkReady() }
    const interval = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen((open) => !open); setCommandQuery('') }
      if (event.key === 'Escape') { setCommandOpen(false); setStatusOpen(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    void fetch('/console-config').then(async (response) => {
      if (response.ok) {
        const config = await response.json() as { api_base_url?: string }
        if (config.api_base_url) setApiBase(config.api_base_url.replace(/\/$/, ''))
      }
    }).catch(() => undefined)
  }, [])

  const loadKeys = async () => {
    setLoading(true)
    setError('')
    try { setKeys(await request<ApiKey[]>('/admin/api-keys')) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar las claves.') }
    finally { setLoading(false) }
  }

  const loadPlaygroundCatalog = async () => {
    setCatalogLoading(true)
    try { setPlaygroundCatalog(await request<PlaygroundCatalog>('/admin/playground/catalog')); setCatalogUpdated(new Date()) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo de modelos.') }
    finally { setCatalogLoading(false) }
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

  const filteredKeys = useMemo(() => keys.filter((key) => `${key.name} ${key.owner ?? ''} ${key.prefix}`.toLowerCase().includes(debouncedSearch)), [keys, debouncedSearch])
  const activeCount = keys.filter((key) => key.is_active).length
  const detailId = location.pathname.match(/^\/keys\/(\d+)/)?.[1]
  const detailKey = detailId ? keys.find((key) => String(key.id) === detailId) : undefined
  const commands = [
    { label: 'Ir a Resumen', hint: 'Navegación', run: () => navigate('/') },
    { label: 'Ir a Claves API', hint: 'Navegación', run: () => navigate('/keys') },
    { label: 'Ir a Modelos', hint: 'Enrutamiento', run: () => navigate('/models') },
    { label: 'Crear una clave', hint: 'Acción', run: () => { dialogReturnFocus.current = document.activeElement as HTMLElement; setCreateOpen(true) } },
    { label: 'Ir a Playground', hint: 'Navegación', run: () => navigate('/playground') },
    { label: 'Ir a Conectar una app', hint: 'Navegación', run: () => navigate('/connect') },
    { label: `Cambiar a tema ${theme === 'light' ? 'oscuro' : 'claro'}`, hint: 'Preferencias', run: () => setTheme((current) => current === 'light' ? 'dark' : 'light') },
    { label: 'Copiar URL base', hint: 'Conexión', run: () => void copy(apiBase, 'endpoint') },
  ].filter((command) => command.label.toLowerCase().includes(commandQuery.trim().toLowerCase()))

  async function signIn(email: string, password: string) {
    setError('')
    setSigningIn(true)
    try {
      const result = await request<{ access_token: string }>('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      sessionStorage.setItem(TOKEN_SLOT, result.access_token)
      setToken(result.access_token)
      setAdmin({ email })
      navigate('/', { replace: true })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.') }
    finally { setSigningIn(false) }
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
    const previous = keys
    setRevokingId(key.id)
    setConfirmRevoke(null)
    setKeys((current) => current.map((item) => item.id === key.id ? { ...item, is_active: false } : item))
    try { await request<void>(`/admin/api-keys/${key.id}`, { method: 'DELETE' }); setNotice(`La clave “${key.name}” quedó revocada.`); await loadKeys() }
    catch (e) { setKeys(previous); setError(e instanceof Error ? e.message : 'No se pudo revocar la clave.') }
    finally { setRevokingId(null) }
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); window.setTimeout(() => setCopied(''), 1800) }
    catch { setError('El navegador no permitió copiar. Selecciona y copia el texto manualmente.') }
  }

  if (!token) return <Login onSubmit={signIn} error={error} busy={signingIn} />

  return <>
    <div className="app-shell" inert={Boolean(createOpen || newKey || confirmRevoke || commandOpen)} aria-hidden={Boolean(createOpen || newKey || confirmRevoke || commandOpen)}>
    <aside className="sidebar" aria-label="Navegación principal">
      <button className="brand brand-button" onClick={() => navigate('/')} aria-label="Relevo, resumen"><span className="brand-mark">r</span><span>relevo<span className="brand-period">.</span></span></button>
      <div className="side-label">PLATAFORMA</div>
      <button className={`nav-item ${tab === 'summary' ? 'active' : ''}`} onClick={() => navigate('/')}><Icon name="home"/><span>Resumen</span></button>
      <button className={`nav-item ${tab === 'keys' ? 'active' : ''}`} onClick={() => navigate('/keys')}><Icon name="key"/><span>Claves API</span><span className="nav-count">{activeCount}</span></button>
      <button className={`nav-item ${tab === 'connect' ? 'active' : ''}`} onClick={() => navigate('/connect')}><Icon name="code"/><span>Conectar una app</span></button>
      <button className={`nav-item ${tab === 'examples' ? 'active' : ''}`} onClick={() => navigate('/playground')}><Icon name="code"/><span>Playground</span></button>
      <button className={`nav-item ${tab === 'models' ? 'active' : ''}`} onClick={() => navigate('/models')}><Icon name="code"/><span>Modelos</span></button>
      <button className="mobile-logout icon-button subtle" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={signOut}><Icon name="logout" size={17}/></button>
      <div className="sidebar-bottom">
        <button className="status-card status-card-button" onClick={() => setStatusOpen((open) => !open)} aria-expanded={statusOpen} aria-label="Detalles del estado del servicio"><span className={`status-pulse ${readyState === 'down' ? 'status-down' : ''}`}/><div><strong>{readyState === 'checking' ? 'Comprobando servicio' : readyState === 'operational' ? 'Servicio listo' : 'Servicio no listo'}</strong><small>{readyState === 'operational' ? 'Base de datos y modelos disponibles' : 'Pulsa para comprobar de nuevo'}</small></div></button>
        <div className="profile"><div className="avatar">{(admin?.email ?? 'A').charAt(0).toUpperCase()}</div><div className="profile-copy"><strong>{admin?.email ?? 'Administrador'}</strong><small>Espacio de trabajo</small></div><button className="icon-button subtle" title="Cerrar sesión" onClick={signOut}><Icon name="logout" size={17}/></button></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>Relevo</span><span className="crumb-slash">/</span><strong>{tab === 'summary' ? 'Resumen' : tab === 'keys' ? 'Claves API' : tab === 'examples' ? 'Playground' : tab === 'models' ? 'Modelos' : 'Conectar una app'}</strong></div><div className="topbar-right"><button className="command-trigger" onClick={() => { setCommandQuery(''); setCommandOpen(true) }} aria-label="Abrir comandos"><Icon name="search" size={16}/><span>Buscar</span><kbd>Ctrl K</kbd></button><button className="icon-button theme-toggle" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} aria-label={`Cambiar a tema ${theme === 'light' ? 'oscuro' : 'claro'}`} title="Cambiar tema"><Icon name={theme === 'light' ? 'moon' : 'sun'} size={16}/></button><button className="service-status-trigger" onClick={() => setStatusOpen((open) => !open)} aria-expanded={statusOpen}><span className={`live-dot ${readyState === 'down' ? 'status-down' : ''}`}/><span>{readyState === 'checking' ? 'Comprobando' : readyState === 'operational' ? 'Servicio listo' : 'Servicio no listo'}</span></button></div>
        {statusOpen && <section className="service-popover" aria-label="Detalles del servicio"><div className="popover-title"><strong>Estado del servicio</strong><button className="icon-button" onClick={() => void checkReady()} aria-label="Volver a comprobar"><Icon name="refresh" size={15}/></button></div><dl><div><dt>Base de datos</dt><dd>{readyInfo?.database === 'ok' ? 'Disponible' : readyInfo?.database ?? 'Sin respuesta'}</dd></div><div><dt>Modelos</dt><dd>{readyInfo?.models === 'available' ? 'Disponibles' : readyInfo?.models ?? 'Sin respuesta'}</dd></div></dl><small>{lastReadyCheck ? `Comprobado ${Math.max(0, Math.floor((Date.now() - lastReadyCheck.getTime()) / 1000))} s atrás` : 'Aún sin comprobar'}</small></section>}
      </header>
      {error && <div className="toast error-toast" role="alert"><span>{error}</span><button onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
      {notice && <div className="toast success-toast" role="status"><Icon name="check" size={16}/><span>{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
      <div className="content-wrap">
        {tab === 'models' ? <RoutingModels request={request} /> : tab === 'summary' ? <Summary keys={keys} activeCount={activeCount} readyState={readyState} loading={loading} onNavigate={navigate} onCreate={() => { dialogReturnFocus.current = document.activeElement as HTMLElement; setCreateOpen(true) }} /> : tab === 'keys' ? <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>GESTIÓN DE ACCESO</div><h1>Tus claves,<br/><em>bajo control.</em></h1><p className="intro">Crea accesos seguros para cada aplicación. Tú decides quién entra y cuándo.</p></div><div className="heading-orbit" aria-hidden="true"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-center"><Icon name="key" size={24}/></div><span className="orbit-spark spark-a"/><span className="orbit-spark spark-b"/></div></section>
          <section className="overview-row"><div className="stat-card"><span className="stat-icon green"><Icon name="key"/></span><div className="stat-value">{keys.length.toString().padStart(2, '0')}</div><div className="stat-caption">Claves creadas</div></div><div className="stat-card"><span className="stat-icon lime"><span className="tiny-pulse"/></span><div className="stat-value">{activeCount.toString().padStart(2, '0')}</div><div className="stat-caption">Accesos activos</div></div><div className="stat-card stat-note"><div className="note-top"><Icon name="shield" size={16}/><span>PROTEGIDAS POR DISEÑO</span></div><p>El secreto completo se muestra una sola vez al crear la clave.</p><button onClick={() => navigate('/connect')}>Cómo conectarse <Icon name="arrow" size={15}/></button></div></section>
          <section className="keys-section"><div className="section-head"><div><div className="section-kicker">ACCESOS DEL ESPACIO</div><h2>Claves API <span className="count-pill">{keys.length}</span></h2></div><button className="primary-button" onClick={openCreateDialog}><Icon name="plus" size={17}/> Nueva clave</button></div>
            <div className="key-toolbar"><div className="search-box"><span className="search-glyph">⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nombre, propietario o prefijo…" aria-label="Buscar por nombre, propietario o prefijo"/></div><button className="icon-button refresh-button" onClick={() => void loadKeys()} title="Actualizar" disabled={loading}><Icon name="refresh" size={17}/></button></div>
            <div className="key-list" aria-busy={loading}>
              {loading && keys.length === 0 ? <div className="empty-state"><span className="spinner"/><p>Cargando accesos…</p></div> : filteredKeys.length === 0 ? <div className="empty-state"><span className="empty-key"><Icon name="key" size={24}/></span><h3>{search ? 'No encontramos coincidencias' : 'Todavía no hay claves'}</h3><p>{search ? 'Prueba con otro nombre o propietario.' : 'Crea una clave para conectar tu primera aplicación.'}</p>{!search && <button className="text-action" onClick={openCreateDialog}>Crear primera clave <Icon name="arrow" size={15}/></button>}</div> : filteredKeys.map((key) => <article className="key-row" key={key.id}><div className="key-glyph"><Icon name="key" size={18}/></div><div className="key-primary"><button className="key-detail-link" onClick={() => navigate(`/keys/${key.id}`)}>{key.name}</button><span>{key.owner || 'Sin propietario asignado'}</span></div><code className="key-prefix">rlv_{key.prefix}••••••••</code><div className="limit-chip">{new Intl.NumberFormat().format(key.requests_per_minute)}<span>/ min</span></div><div className={`key-state ${key.is_active ? 'is-active' : 'is-revoked'}`}><i/>{key.is_active ? 'Activa' : 'Revocada'}</div>{key.is_active ? <button className="revoke-button" title={`Revocar ${key.name}`} onClick={(event) => { dialogReturnFocus.current = event.currentTarget; setConfirmRevoke(key) }} disabled={revokingId === key.id}><Icon name="trash" size={16}/><span>{revokingId === key.id ? 'Revocando…' : 'Revocar'}</span></button> : <span className="revoked-label">Sin acceso</span>}</article>)}
            </div>
            <div className="list-foot"><span>El secreto completo solo se muestra al crear la clave.</span><span><span className="tiny-pulse"/> Secreto visible una sola vez</span></div>
          </section>
        </> : tab === 'connect' ? <ConnectGuide onCopy={copy} copied={copied} apiBase={apiBase} /> : <Playground catalog={playgroundCatalog} onManageKeys={() => navigate('/keys')} onRefresh={() => void loadPlaygroundCatalog()} catalogLoading={catalogLoading} catalogUpdated={catalogUpdated} />}
        <footer className="page-footer"><span>RELEVO <b>·</b> ACCESO A MODELOS, EN UN SOLO LUGAR</span><a href="/openapi.json" target="_blank" rel="noopener noreferrer">Referencia de API <Icon name="external" size={13}/></a></footer>
      </div>
    </main>
    </div>
    {commandOpen && <CommandPalette query={commandQuery} onQueryChange={setCommandQuery} commands={commands} onClose={() => setCommandOpen(false)} onChoose={(run) => { setCommandOpen(false); run() }} />}
    {detailKey && <ApiKeyDetailDialog item={detailKey} onClose={() => navigate('/keys')} />}
    {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} onSubmit={createKey} returnFocus={dialogReturnFocus.current}/>}
    {newKey && <SecretDialog value={newKey.api_key} name={newKey.name} onClose={() => setNewKey(null)} onCopy={() => void copy(newKey.api_key, 'secret')} copied={copied === 'secret'} returnFocus={dialogReturnFocus.current} />}
    {confirmRevoke && <ConfirmDialog keyInfo={confirmRevoke} onClose={() => setConfirmRevoke(null)} onConfirm={() => void revokeKey(confirmRevoke)} returnFocus={dialogReturnFocus.current}/>}
  </>
}

function Summary({ keys, activeCount, readyState, loading, onNavigate, onCreate }: { keys: ApiKey[]; activeCount: number; readyState: 'checking' | 'operational' | 'down'; loading: boolean; onNavigate: (path: string) => void; onCreate: () => void }) {
  const latest = [...keys].sort((a, b) => b.id - a.id).slice(0, 4)
  return <>
    <section className="summary-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>ESPACIO DE TRABAJO</div><h1>Resumen</h1><p>Una vista rápida de tus accesos y la disponibilidad de Relevo.</p></div><button className="primary-button" onClick={onCreate}><Icon name="plus" size={16}/> Nueva clave</button></section>
    <section className="summary-cards" aria-label="Resumen de actividad">
      <article><span>Claves registradas</span><strong>{loading && keys.length === 0 ? '—' : new Intl.NumberFormat().format(keys.length)}</strong><small>Incluye claves activas y revocadas</small></article>
      <article><span>Claves activas</span><strong>{loading && keys.length === 0 ? '—' : new Intl.NumberFormat().format(activeCount)}</strong><small>Con acceso a la API</small></article>
      <article className="summary-service"><span>Estado del servicio</span><strong><i className={`summary-dot ${readyState}`}/>{readyState === 'checking' ? 'Comprobando' : readyState === 'operational' ? 'Disponible' : 'Con problemas'}</strong><small>Se actualiza automáticamente cada 30 segundos</small></article>
    </section>
    <section className="summary-lower">
      <article className="summary-panel"><div className="summary-panel-heading"><div><span className="section-kicker">ACCESOS RECIENTES</span><h2>Tus claves</h2></div><button className="text-action" onClick={() => onNavigate('/keys')}>Ver todas <Icon name="arrow" size={15}/></button></div>
        {latest.length ? <ul className="summary-key-list">{latest.map((key) => <li key={key.id}><span className="key-glyph"><Icon name="key" size={16}/></span><span className="summary-key-name"><strong>{key.name}</strong><small>{key.owner || `rlv_${key.prefix}`}</small></span><span className={`summary-key-state ${key.is_active ? 'is-active' : 'is-revoked'}`}>{key.is_active ? 'Activa' : 'Revocada'}</span></li>)}</ul> : loading ? <div className="summary-empty" role="status"><span className="spinner"/><span>Cargando claves…</span></div> : <div className="summary-empty"><span className="empty-key"><Icon name="key" size={20}/></span><h3>Aún no hay claves</h3><p>Crea una clave para conectar tu primera aplicación.</p><button className="text-action" onClick={onCreate}>Crear una clave <Icon name="arrow" size={15}/></button></div>}
      </article>
      <article className="summary-panel quick-links"><span className="section-kicker">CONTINÚA</span><h2>¿Qué necesitas hacer?</h2><button onClick={() => onNavigate('/connect')}><Icon name="code" size={17}/><span><strong>Conectar una aplicación</strong><small>Guías y ejemplos de integración</small></span><Icon name="arrow" size={15}/></button><button onClick={() => onNavigate('/playground')}><Icon name="image" size={17}/><span><strong>Probar en Playground</strong><small>Envía una solicitud de prueba</small></span><Icon name="arrow" size={15}/></button><p className="summary-coming-soon">Administración de proveedores, límites por modelo y estadísticas: <strong>Próximamente</strong></p></article>
    </section>
  </>
}

function ApiKeyDetailDialog({ item, onClose }: { item: ApiKey; onClose: () => void }) {
  const dialogRef = useDialogFocus(onClose)
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={dialogRef} className="modal key-detail-modal" role="dialog" aria-modal="true" aria-labelledby="key-detail-title"><button className="modal-close" onClick={onClose} aria-label="Cerrar detalles"><Icon name="close"/></button><div className="modal-icon"><Icon name="key" size={20}/></div><div className="modal-kicker">DETALLE DE CLAVE</div><h2 id="key-detail-title">{item.name}</h2><p className="modal-description">Identificador de acceso y límites configurados.</p><dl className="key-detail-list"><div><dt>Propietario</dt><dd>{item.owner || 'Sin propietario asignado'}</dd></div><div><dt>Prefijo</dt><dd><code>rlv_{item.prefix}••••••••</code></dd></div><div><dt>Límite por minuto</dt><dd>{new Intl.NumberFormat().format(item.requests_per_minute)}</dd></div><div><dt>Estado</dt><dd>{item.is_active ? 'Activa' : 'Revocada'}</dd></div></dl><p className="detail-security-note">El prefijo identifica la clave; no permite recuperar su secreto.</p><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button></div></section></div>
}

function CommandPalette({ query, onQueryChange, commands, onClose, onChoose }: { query: string; onQueryChange: (value: string) => void; commands: { label: string; hint: string; run: () => void }[]; onClose: () => void; onChoose: (run: () => void) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const paletteRef = useRef<HTMLElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; inputRef.current?.focus(); return () => { if (previous?.isConnected) previous.focus() } }, [])
  return <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-title" onKeyDown={(event) => { const items = Array.from(paletteRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []); if (event.key === 'Enter' && event.target === inputRef.current && items.length) { event.preventDefault(); items[0].click(); return } if (event.key === 'Tab') { const focusable = [inputRef.current, ...items].filter((item): item is HTMLInputElement | HTMLButtonElement => Boolean(item)); if (!focusable.length) return; if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus() } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus() } return } if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return; event.preventDefault(); if (!items.length) return; const current = items.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length - 1 : current - 1); items[next]?.focus() }}><h2 id="command-title" className="visually-hidden">Acciones rápidas</h2><label className="command-search"><Icon name="search" size={18}/><input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Buscar páginas o acciones…" aria-label="Buscar páginas o acciones"/><kbd>Esc</kbd></label><div className="command-list" role="listbox" aria-label="Acciones">{commands.length ? commands.map((command) => <button role="option" aria-selected="false" key={command.label} onClick={() => onChoose(command.run)}><span>{command.label}</span><small>{command.hint}</small></button>) : <p className="command-empty">No hay acciones que coincidan.</p>}</div><footer><span>Usa <kbd>↑</kbd> <kbd>↓</kbd> para navegar</span><span><kbd>Esc</kbd> para cerrar</span></footer></section></div>
}

function Login({ onSubmit, error, busy }: { onSubmit: (email: string, password: string) => void; error: string; busy: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  return <div className="login-screen"><aside className="login-art" aria-label="Información de Relevo"><div className="art-grid"/><div className="login-art-content"><a className="brand light-brand" href="#inicio"><span className="brand-mark">r</span><span>relevo<span className="brand-period">.</span></span></a><div className="art-copy"><div className="eyebrow light-eyebrow"><span className="eyebrow-line"/>UNA SOLA PUERTA. MUCHOS MODELOS.</div><h1>Tu IA.<br/><em>Tu manera.</em></h1><p>Un acceso simple para conectar tus herramientas con los modelos que mueven tus ideas.</p></div><div className="art-bottom"><div className="art-stat"><strong>01</strong><span>API key<br/>por aplicación</span></div><div className="art-stat"><strong>∞</strong><span>Modelos<br/>a tu alcance</span></div><div className="art-star">✳</div></div></div><div className="login-decoration"><div className="decor-line d1"/><div className="decor-line d2"/><div className="decor-circle"/><span className="decor-cross">✳</span></div></aside><main className="login-panel"><div className="login-form-wrap"><div className="login-kicker">PANEL ADMINISTRATIVO</div><h2>Qué bueno<br/>verte de nuevo.</h2><p className="login-lede">Inicia sesión para administrar las conexiones de tu espacio.</p>{error && <div className="form-error" role="alert">{error}</div>}<form onSubmit={(e) => { e.preventDefault(); onSubmit(email, password) }}><label>Correo de administrador<input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" required disabled={busy}/></label><label>Contraseña<div className="password-wrap"><input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Tu contraseña" required disabled={busy}/><button type="button" aria-pressed={show} onClick={() => setShow(!show)} disabled={busy}>{show ? 'Ocultar' : 'Mostrar'}</button></div></label><button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar al panel'} <Icon name={busy ? 'refresh' : 'arrow'} size={17}/></button></form><div className="login-hint"><Icon name="shield" size={16}/><span>Tu sesión es temporal y se guarda solo en esta pestaña.</span></div></div><div className="login-foot">© {new Date().getFullYear()} RELEVO <span>·</span> HECHO PARA CONECTAR</div></main></div>
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

function ConnectGuide({ onCopy, copied, apiBase }: { onCopy: (text: string, label: string) => void; copied: string; apiBase: string }) {
  const [language, setLanguage] = useState<'curl' | 'javascript' | 'python'>('curl')
  const endpoint = `${apiBase}/v1`
  const samples = {
    curl: `curl ${endpoint}/chat/completions -H 'Authorization: Bearer <RELEVO_API_KEY>' -H 'Content-Type: application/json' -d '{"model":"auto","messages":[{"role":"user","content":"Hola"}]}'`,
    javascript: [
      "import OpenAI from 'openai'",
      '',
      'const client = new OpenAI({',
      `  baseURL: '${endpoint}',`,
      '  apiKey: process.env.RELEVO_API_KEY,',
      '})',
      '',
      'const response = await client.chat.completions.create({',
      "  model: 'auto',",
      "  messages: [{ role: 'user', content: 'Hola' }],",
      '})',
      'console.log(response.choices[0].message.content)',
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

