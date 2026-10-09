import { useEffect, useId, useRef, useState } from 'react'
import type { PlaygroundModel } from './types'
import { PlaygroundIcon as Icon } from './Icon'

export function ModelPicker({ models, value, onChange, disabled, loading, onRefresh, openRequested = false, onOpenHandled }: { models: PlaygroundModel[]; value: string; onChange: (value: string) => void; disabled: boolean; loading: boolean; onRefresh: () => void; openRequested?: boolean; onOpenHandled?: () => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const id = useId()
  const selected = models.find((item) => item.id === value)
  const providers = [...new Map(models.map((item) => [item.provider, item.provider_name])).entries()]
  const filtered = models.filter((item) => (provider === 'all' || item.provider === provider) && `${item.id} ${item.provider_name}`.toLowerCase().includes(query.trim().toLowerCase()))
  const activeOption = Math.min(active, Math.max(0, filtered.length - 1))
  function close() { setOpen(false); trigger.current?.focus() }
  function choose(next: string) { onChange(next); close() }
  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => {
    if (!openRequested) return
    setOpen(true); setQuery(''); setProvider('all'); setActive(0); onOpenHandled?.()
  }, [openRequested, onOpenHandled])

  return <div className="pg-model-picker" ref={root}>
    <button ref={trigger} className="pg-model-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`Seleccionar modelo: ${value === 'auto' ? 'Automático' : value}`} onClick={() => { setOpen(!open); setQuery(''); setProvider('all'); setActive(0) }}>
      <span className={`pg-provider-mark ${value === 'auto' ? 'auto' : ''}`}>{value === 'auto' ? <Icon name="spark" size={16}/> : (selected?.provider_name ?? 'M').slice(0, 1)}</span>
      <span><strong>{value === 'auto' ? 'Automático' : selected?.name ?? value}</strong><small>{value === 'auto' ? 'El modelo adecuado para tu tarea' : selected?.provider_name ?? 'Modelo seleccionado'}</small></span>
      <Icon name="chevron" size={15}/>
    </button>
    {open && <section id={id} className="pg-model-popover" role="dialog" aria-label="Elegir modo y modelo" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key === 'Tab') {
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]),input:not([disabled])'))
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
      }
    }}>
      <div className="pg-picker-heading"><span>Elige cómo responder</span><button className="pg-icon-button" onClick={close} aria-label="Cerrar selector"><Icon name="close" size={15}/></button></div>
      <button className={`pg-auto-option ${value === 'auto' ? 'selected' : ''}`} onClick={() => choose('auto')}><span className="pg-provider-mark auto"><Icon name="spark"/></span><span><strong>Automático</strong><small>Analiza la tarea y selecciona un modelo compatible.</small></span>{value === 'auto' && <Icon name="check" size={17}/>}</button>
      <div className="pg-picker-label"><span>O SELECCIONA UN MODELO</span><button className="pg-icon-button" onClick={onRefresh} disabled={loading} aria-label="Actualizar modelos"><Icon name="refresh" size={14}/></button></div>
      <div className="pg-picker-search"><Icon name="search" size={16}/><input ref={search} role="combobox" aria-label="Buscar modelos" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-options`} aria-activedescendant={filtered.length ? `${id}-option-${activeOption}` : undefined} value={query} placeholder="Buscar por modelo o proveedor…" onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current) => Math.min(filtered.length - 1, current + 1)) }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => Math.max(0, current - 1)) }
        if (event.key === 'Enter' && filtered[activeOption]) { event.preventDefault(); choose(filtered[activeOption].id) }
      }}/></div>
      <div className="pg-provider-filters" aria-label="Filtrar por proveedor"><button className={provider === 'all' ? 'selected' : ''} onClick={() => { setProvider('all'); setActive(0) }}>Todos</button>{providers.map(([slug, name]) => <button key={slug} className={provider === slug ? 'selected' : ''} onClick={() => { setProvider(slug); setActive(0) }}>{name}</button>)}</div>
      <div className="pg-picker-options" role="listbox" id={`${id}-options`} aria-label="Modelos disponibles" aria-busy={loading}>
        {filtered.map((item, index) => <button key={item.id} id={`${id}-option-${index}`} className={`pg-picker-option ${index === activeOption ? 'highlighted' : ''}`} role="option" aria-selected={value === item.id} tabIndex={-1} onMouseEnter={() => setActive(index)} onClick={() => choose(item.id)}>
          <span className="pg-provider-mark">{item.provider_name.slice(0,1)}</span><span><strong>{item.name}</strong><small>{item.provider_name} · {item.id}</small></span><span className="pg-option-capabilities">{item.capabilities.includes('vision') && <span>Visión</span>}{value === item.id && <Icon name="check" size={16}/>}</span>
        </button>)}
        {!filtered.length && <p className="pg-no-models">{loading ? 'Actualizando catálogo…' : models.length ? 'No encontramos coincidencias. Prueba otra búsqueda.' : 'No hay modelos disponibles. Configura un proveedor para empezar.'}</p>}
      </div>
      <footer><span>{filtered.length} modelos</span><span>↑ ↓ para navegar · Enter para elegir</span></footer>
    </section>}
  </div>
}
