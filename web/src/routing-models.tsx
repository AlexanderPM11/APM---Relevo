import { useEffect, useState } from 'react'

type Model = {
  id: number; provider_id: number; name: string; alias: string | null; priority: number
  weight: number; context_max: number; capabilities: string[]; is_enabled: boolean; tier: number
  is_free: boolean | null; routing_profile: 'light' | 'balanced' | 'advanced' | null
  routing_tasks: string[] | null
}
type Requester = <T>(path: string, init?: RequestInit) => Promise<T>
const taskOptions = [
  ['conversation', 'Conversación'], ['writing', 'Redacción y traducción'],
  ['summarization', 'Resumen y extracción'], ['programming', 'Programación'],
  ['reasoning', 'Análisis y razonamiento'], ['other', 'Otras tareas'],
]

export function RoutingModels({ request }: { request: Requester }) {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  async function load() {
    setLoading(true)
    try {
      await request('/admin/playground/catalog')
      setModels(await request<Model[]>('/admin/models'))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los modelos.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  function update(id: number, patch: Partial<Model>) {
    setModels((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  async function save(model: Model) {
    setSaving(model.id); setError(''); setSaved('')
    try {
      await request(`/admin/models/${model.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          provider_id: model.provider_id, name: model.name, alias: model.alias,
          priority: model.priority, weight: model.weight, context_max: model.context_max,
          capabilities: model.capabilities, is_enabled: model.is_enabled, tier: model.tier,
          is_free: model.is_free, routing_profile: model.routing_profile,
          routing_tasks: model.routing_tasks ?? [],
        }),
      })
      setSaved(model.name)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron guardar los cambios.') }
    finally { setSaving(null) }
  }

  return <>
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>ENRUTAMIENTO</div><h1>Modelos,<br/><em>para cada tarea.</em></h1><p className="intro">Indica qué modelos son gratuitos y en qué tareas destacan. Relevo usará estos datos cuando el selector Laya esté activo.</p></div></section>
    <section className="keys-section routing-models-section">
      <div className="section-head"><div><div className="section-kicker">PERFILES DEL SELECTOR</div><h2>Catálogo de modelos <span className="count-pill">{models.length}</span></h2></div><button className="icon-button refresh-button" onClick={() => void load()} title="Actualizar modelos" disabled={loading}>↻</button></div>
      {error && <p className="routing-message routing-error" role="alert">{error}</p>}
      {saved && <p className="routing-message" role="status">Cambios guardados para {saved}.</p>}
      {loading ? <div className="empty-state"><span className="spinner"/><p>Cargando catálogo…</p></div> : models.length === 0 ? <p className="catalog-empty">No hay modelos configurados. Añade credenciales de proveedores y actualiza el catálogo.</p> : <div className="routing-model-list">{models.map((model) => <article className="routing-model-card" key={model.id}>
        <div className="routing-model-heading"><div><strong>{model.alias || model.name}</strong><small>{model.name} · contexto {new Intl.NumberFormat().format(model.context_max)}</small></div><span className={model.is_enabled ? 'key-state is-active' : 'key-state is-revoked'}><i/>{model.is_enabled ? 'Activo' : 'Desactivado'}</span></div>
        <div className="routing-model-controls">
          <label><span>Disponibilidad gratuita</span><select value={model.is_free === null ? 'unknown' : String(model.is_free)} onChange={(event) => update(model.id, { is_free: event.target.value === 'unknown' ? null : event.target.value === 'true' })}><option value="unknown">Sin verificar</option><option value="true">Gratis verificado</option><option value="false">De pago</option></select></label>
          <label><span>Perfil de capacidad</span><select value={model.routing_profile ?? ''} onChange={(event) => update(model.id, { routing_profile: (event.target.value || null) as Model['routing_profile'] })}><option value="">Sin clasificar</option><option value="light">Ligero</option><option value="balanced">Equilibrado</option><option value="advanced">Avanzado</option></select></label>
        </div>
        <fieldset className="routing-task-field"><legend>Tareas recomendadas</legend><div className="routing-task-options">{taskOptions.map(([key, label]) => <label key={key}><input type="checkbox" checked={(model.routing_tasks ?? []).includes(key)} onChange={(event) => update(model.id, { routing_tasks: event.target.checked ? [...(model.routing_tasks ?? []), key] : (model.routing_tasks ?? []).filter((task) => task !== key) })}/>{label}</label>)}</div></fieldset>
        <div className="routing-model-save"><small>{model.is_free === true ? 'Apto para enrutamiento gratis' : model.is_free === false ? 'Se excluirá del modo solo gratis' : 'La gratuidad aún no está verificada'}</small><button className="primary-button" onClick={() => void save(model)} disabled={saving !== null}>{saving === model.id ? 'Guardando…' : 'Guardar perfil'}</button></div>
      </article>)}</div>}
      <p className="routing-note">Activa el selector con <code>ROUTER_STRATEGY=laya</code> y <code>LAYA_ROUTING_MODE=shadow</code>. Para aplicar las decisiones, cambia el modo a <code>active</code>. Usa <code>ROUTER_FREE_ONLY=true</code> para exigir gratuidad verificada.</p>
    </section>
  </>
}
