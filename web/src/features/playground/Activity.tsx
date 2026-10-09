import type { ChatEntry, StreamEvent } from './types'
import { PlaygroundIcon as Icon } from './Icon'

export const taskNames: Record<string, string> = { conversation: 'Conversación', writing: 'Redacción', summarization: 'Resumen', programming: 'Programación', reasoning: 'Análisis y planificación', other: 'Otra tarea' }
const complexityNames: Record<string, string> = { simple: 'Simple', intermediate: 'Intermedia', complex: 'Compleja' }
export function eventLabel(event: StreamEvent): { title: string; detail: string } {
  switch (event.event) {
    case 'routing': return { title: event.mode === 'manual' ? 'Selección manual' : 'Clasificando tu tarea', detail: event.mode === 'manual' ? 'Comprobando compatibilidad y disponibilidad.' : 'Analizando el prompt y el contexto de la conversación.' }
    case 'classified': return event.routing ? { title: taskNames[event.routing.task] ?? event.routing.task, detail: `Complejidad ${complexityNames[event.routing.complexity]?.toLowerCase() ?? event.routing.complexity} · ${event.routing.classifier.startsWith('laya') ? 'Laya' : 'Reglas locales'}${event.routing.fallback ? ' · con ajuste local' : ''}` } : { title: 'Modelo compatible', detail: `${event.candidates ?? 0} opciones disponibles.` }
    case 'selected': return { title: 'Modelo seleccionado', detail: `${event.model} · ${event.provider_name ?? event.provider} · intento ${event.attempt ?? 1}` }
    case 'requesting': return { title: 'Solicitud al modelo', detail: `Esperando la respuesta de ${event.model}.` }
    case 'response_started': return { title: 'Recibiendo respuesta', detail: `El texto llega directamente de ${event.model}.` }
    case 'unavailable': return { title: 'Límite del modelo alcanzado', detail: `${event.model} no tiene cuota disponible.` }
    case 'fallback': return { title: 'Intento sin respuesta', detail: `${event.model} falló. Buscando otra opción disponible.` }
    case 'completed': return { title: 'Respuesta completada', detail: 'La respuesta y el modelo quedaron guardados en el chat.' }
    case 'stopped': return { title: 'Generación detenida', detail: 'Se conserva el texto recibido hasta este momento.' }
    case 'error': return { title: 'Solicitud interrumpida', detail: event.message ?? 'Puedes volver a intentar.' }
    default: return { title: 'Procesando', detail: '' }
  }
}
export function Activity({ entry, sending }: { entry?: ChatEntry; sending: boolean }) {
  const events = entry?.events ?? []
  const routing = events.find((event) => event.event === 'classified')?.routing
  return <div className="pg-activity-content">
    <div className="pg-activity-heading"><span className="pg-label">ACTIVIDAD</span><span className={`pg-live-badge ${sending ? 'running' : ''}`}><i/>{sending ? 'En vivo' : entry ? 'Última solicitud' : 'En espera'}</span></div>
    <h2>Así responde Relevo</h2><p className="pg-activity-intro">Cada decisión, desde tu mensaje hasta el modelo que responde.</p>
    {!events.length ? <div className="pg-activity-empty"><span><Icon name="activity" size={25}/></span><strong>Todo el proceso, a la vista.</strong><p>Envía un mensaje para ver la categoría, el modelo elegido y su respuesta en tiempo real.</p><ol><li>Analizar la tarea</li><li>Elegir el modelo</li><li>Recibir la respuesta</li></ol></div> : <>
      {routing && <div className="pg-routing-summary"><small>CATEGORÍA DETECTADA</small><strong>{taskNames[routing.task] ?? routing.task}</strong><span>{complexityNames[routing.complexity] ?? routing.complexity}{routing.confidence > 0 ? ` · ${Math.round(routing.confidence * 100)}% confianza` : ''}</span></div>}
      <ol className="pg-timeline">{events.map((event, index) => {
        const label = eventLabel(event)
        const current = sending && index === events.length - 1
        return <li key={index} className={`${current ? 'current' : ''} ${event.event === 'error' || event.event === 'fallback' ? 'warning' : ''}`}><span className="pg-step-dot">{current ? <i/> : event.event === 'error' || event.event === 'fallback' ? '!' : <Icon name="check" size={10}/>}</span><div><strong>{label.title}</strong><p>{label.detail}</p>{event.elapsed_ms !== undefined && <time>{(event.elapsed_ms / 1000).toFixed(1)} s</time>}</div></li>
      })}</ol>
      {entry?.model && <div className="pg-final-model"><small>MODELO QUE RESPONDE</small><strong>{entry.model}</strong><span>{entry.provider}</span></div>}
      {entry?.status === 'complete' && <div className="pg-request-metrics"><div><strong>{((entry.elapsed_ms ?? 0) / 1000).toFixed(1)} s</strong><span>Tiempo total</span></div><div><strong>{entry.tokens ?? '—'}</strong><span>Tokens reportados</span></div><div><strong>{entry.attempts ?? 1}</strong><span>Intentos</span></div></div>}
    </>}
    <div className="pg-activity-foot"><Icon name="spark" size={15}/><span>Decisiones reales del servidor.<br/>Sin estados simulados.</span></div>
  </div>
}
