import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter } from './app/router'
import { initializeObservability } from './observability'

initializeObservability()
createRoot(document.getElementById('root')!).render(<StrictMode><AppRouter/></StrictMode>)
