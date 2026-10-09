import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

const ConsoleApp = lazy(() => import('../app').then(({ App }) => ({ default: App })))

export function AppRouter() {
  return <BrowserRouter basename="/console"><Suspense fallback={<div className="route-loading" role="status">Cargando consola…</div>}><Routes>
    <Route path="/login" element={<ConsoleApp/>}/>
    <Route path="/keys/*" element={<ConsoleApp/>}/>
    <Route path="/connect" element={<ConsoleApp/>}/>
    <Route path="/playground" element={<ConsoleApp/>}/>
    <Route path="/" element={<ConsoleApp/>}/>
    <Route path="*" element={<Navigate to="/keys" replace/>}/>
  </Routes></Suspense></BrowserRouter>
}
