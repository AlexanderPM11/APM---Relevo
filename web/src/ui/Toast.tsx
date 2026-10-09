import { useEffect } from 'react'
import './components.css'
export function Toast({tone='info',title,description,onClose}: {tone?:'success'|'error'|'warning'|'info';title:string;description?:string;onClose?:()=>void}){
 useEffect(()=>{if(!onClose)return;const timer=window.setTimeout(onClose,4500);return()=>window.clearTimeout(timer)},[onClose])
 return <div className={`ui-toast ui-toast--${tone}`} role={tone==='error'?'alert':'status'}><div><strong>{title}</strong>{description&&<p>{description}</p>}</div>{onClose&&<button type="button" onClick={onClose} aria-label="Cerrar notificación">×</button>}</div>
}
