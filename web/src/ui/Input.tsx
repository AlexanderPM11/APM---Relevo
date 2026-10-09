import { useId, useState, type InputHTMLAttributes } from 'react'
import './components.css'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>{label?:string;hint?:string;error?:string}
export function Input({label,hint,error,id,type='text',...props}:InputProps){
  const generatedId=useId(); const inputId=id??generatedId; const hintId=`${inputId}-hint`; const errorId=`${inputId}-error`
  return <div className="ui-field">{label&&<label className="ui-label" htmlFor={inputId}>{label}</label>}<input {...props} id={inputId} type={type} className={`ui-input${error?' ui-input--error':''}`} aria-invalid={Boolean(error)||undefined} aria-describedby={error?errorId:hint?hintId:undefined}/>{error&&<span id={errorId} className="ui-error" role="alert">{error}</span>}{!error&&hint&&<span id={hintId} className="ui-hint">{hint}</span>}</div>
}
export function PasswordInput({label='Contraseña',...props}:Omit<InputProps,'type'>){
  const [visible,setVisible]=useState(false)
  return <div className="ui-password"><Input {...props} label={label} type={visible?'text':'password'}/><button className="ui-password-toggle" type="button" aria-label={visible?'Ocultar contraseña':'Mostrar contraseña'} aria-pressed={visible} onClick={()=>setVisible(value=>!value)}>{visible?'Ocultar':'Mostrar'}</button></div>
}
