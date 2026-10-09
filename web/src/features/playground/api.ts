import type { StreamEvent } from './types'

const friendly: Record<string, string> = {
  'No compatible model is currently available': 'No hay un modelo compatible disponible. Revisa las capacidades o elige Automático.',
  'All available models failed': 'Los modelos disponibles no pudieron responder. Puedes volver a intentar.',
  'All configured providers rejected authentication': 'Los proveedores rechazaron sus credenciales. Revisa la configuración.',
  'Active API key not found': 'Esta clave ya no está activa. Selecciona otra clave.',
  'API key rate limit exceeded': 'Alcanzaste el límite de esta clave. Espera un minuto antes de volver a enviar.',
  'Provider stream ended before completion': 'La respuesta se interrumpió. Conservamos el texto recibido.',
  'Provider returned no text content': 'El modelo no devolvió texto. Prueba con otro modelo.',
  'Provider timed out': 'El proveedor tardó demasiado en responder. Puedes volver a intentar.',
  'Provider rejected the request': 'El proveedor rechazó esta solicitud.',
  'Provider network error': 'Se interrumpió la conexión con el proveedor.',
}
export function errorMessage(message: string) { return friendly[message] ?? message }

export async function streamChat(body: unknown, signal: AbortSignal, onEvent: (event: StreamEvent) => void) {
  const token = sessionStorage.getItem('relevo.admin.session')
  const response = await fetch('/admin/playground/chat/stream', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  if (response.status === 401) {
    sessionStorage.removeItem('relevo.admin.session')
    window.dispatchEvent(new Event('relevo:session-expired'))
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(errorMessage(result.detail ?? 'No se pudo conectar con Relevo.'))
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('El servidor no devolvió un canal de eventos válido.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let terminal = false
  function frame(raw: string) {
    const data = raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data) return
    const event = JSON.parse(data) as StreamEvent
    if (event.event === 'completed' || event.event === 'error') terminal = true
    onEvent(event)
    if (event.event === 'error') throw new Error(errorMessage(event.message ?? 'La solicitud falló.'))
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
      pending = pending.replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        frame(pending.slice(0, boundary))
        pending = pending.slice(boundary + 2)
      }
      if (done) { if (pending.trim()) frame(pending); break }
    }
    if (!terminal) throw new Error('La conexión se interrumpió antes de terminar. Conservamos el texto recibido.')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
