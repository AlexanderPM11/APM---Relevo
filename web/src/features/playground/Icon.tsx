import type { ReactNode } from 'react'

export function PlaygroundIcon({ name, size = 18 }: { name: 'plus' | 'search' | 'chevron' | 'spark' | 'chat' | 'close' | 'send' | 'stop' | 'image' | 'download' | 'copy' | 'check' | 'refresh' | 'history' | 'activity' | 'trash' | 'edit' | 'settings'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    chevron: <path d="m7 10 5 5 5-5"/>, spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></>,
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5A8.5 8.5 0 0 1 11.5 3h1a8.5 8.5 0 0 1 8.5 8.5Z"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, send: <path d="M12 20V4m-6 6 6-6 6 6"/>, stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    image: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m21 16-5-5L5 20"/></>,
    download: <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>, copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    check: <path d="m5 12 4 4L19 6"/>, refresh: <><path d="M20 4v6h-6"/><path d="M20 10a8 8 0 1 0 0 5"/></>,
    history: <><path d="M3 3v6h6M3 9a9 9 0 1 1 0 6"/><path d="M12 7v5l3 2"/></>, activity: <path d="M2 12h5l3-8 4 16 3-8h5"/>,
    trash: <><path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v6m4-6v6"/></>,
    edit: <><path d="m15 4 5 5L8 21H3v-5L15 4Z"/><path d="m12 7 5 5"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--pg-surface)"/><circle cx="15" cy="17" r="3" fill="var(--pg-surface)"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
