import type { HTMLAttributes } from 'react'
import './components.css'
export function Badge({tone='neutral',dot=false,className='',...props}:HTMLAttributes<HTMLSpanElement>&{tone?:'neutral'|'success'|'warning'|'danger'|'info';dot?:boolean}){return <span {...props} className={`ui-badge ui-badge--${tone} ${className}`.trim()}>{dot&&<span className="ui-badge-dot" aria-hidden="true"/>}{props.children}</span>}
