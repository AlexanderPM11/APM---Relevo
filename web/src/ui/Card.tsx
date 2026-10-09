import type { HTMLAttributes, ReactNode } from 'react'
import './components.css'
export function Card({header,footer,children,className='',...props}:HTMLAttributes<HTMLElement>&{header?:ReactNode;footer?:ReactNode}){return <section {...props} className={`ui-card ${className}`.trim()}>{header&&<header className="ui-card-header">{header}</header>}<div className="ui-card-content">{children}</div>{footer&&<footer className="ui-card-footer">{footer}</footer>}</section>}
