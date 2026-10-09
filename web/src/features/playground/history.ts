import type { Conversation } from './types'

type StoredChat = Conversation & { storageId: string; owner: string }

export function historyOwner() {
  try {
    const encoded = sessionStorage.getItem('relevo.admin.session')?.split('.')[1]
    if (!encoded) return 'local'
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
    return String((JSON.parse(new TextDecoder().decode(bytes)) as { sub?: string }).sub ?? 'local')
  } catch { return 'local' }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('relevo.playground.v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('chats', { keyPath: 'storageId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadHistory(owner: string): Promise<Conversation[]> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('chats').objectStore('chats').getAll()
      request.onsuccess = () => resolve((request.result as StoredChat[]).filter((chat) => chat.owner === owner).map((chat) => ({ ...chat, entries: chat.entries.map((entry) => entry.status === 'pending' ? { ...entry, status: 'stopped' as const } : entry) })).sort((a, b) => b.updated - a.updated))
      request.onerror = () => reject(request.error)
    })
  } finally { database.close() }
}

export async function saveConversation(owner: string, chat: Conversation) {
  await writeHistory((store) => store.put({ ...chat, storageId: `${owner}:${chat.id}`, owner }))
}
export async function deleteConversation(owner: string, id: string) {
  await writeHistory((store) => store.delete(`${owner}:${id}`))
}
async function writeHistory(write: (store: IDBObjectStore) => IDBRequest) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('chats', 'readwrite')
      write(transaction.objectStore('chats'))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { database.close() }
}

export function exportConversation(chat: Conversation) {
  const content = `# ${chat.title}\n\n` + chat.entries.map((entry) => `## ${entry.role === 'user' ? 'Tú' : entry.model ?? 'Relevo'}\n\n${entry.content}\n${entry.images.map((image) => `\n[Imagen adjunta: ${image.name}]`).join('')}${entry.provider ? `\n\n_Proveedor: ${entry.provider} · Intentos: ${entry.attempts ?? 1}_` : ''}`).join('\n\n---\n\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${chat.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 70) || 'conversacion'}.md`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
