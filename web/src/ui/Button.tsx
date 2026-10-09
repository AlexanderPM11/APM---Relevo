import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './components.css'

export type ButtonVariant = 'primary'|'secondary'|'ghost'|'danger'
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>{variant?:ButtonVariant;size?:'sm'|'md'|'lg';loading?:boolean;iconLeft?:ReactNode;iconRight?:ReactNode}
export function Button({variant='primary',size='md',loading=false,iconLeft,iconRight,disabled,children,className='',...props}:ButtonProps){
  return <button {...props} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()} disabled={disabled||loading} aria-busy={loading||undefined}>
    {loading&&<span className="ui-spinner" aria-hidden="true"/>}{!loading&&iconLeft}<span>{children}</span>{!loading&&iconRight}
  </button>
}
