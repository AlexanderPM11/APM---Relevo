import { useEffect, useRef, type ReactNode } from 'react'
import './components.css'
export function Modal({open,title,description,onClose,children}: {open:boolean;title:string;description?:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null)
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement|null;const box=ref.current;const focusable=()=>Array.from(box?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]')??[]);focusable()[0]?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose();return}if(event.key==='Tab'){const items=focusable();if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus?.()}},[open,onClose])
 if(!open)return null
 return <div className="ui-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><div ref={ref} className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="ui-modal-title" aria-describedby={description?'ui-modal-description':undefined}><h2 id="ui-modal-title">{title}</h2>{description&&<p id="ui-modal-description">{description}</p>}{children}</div></div>
}
