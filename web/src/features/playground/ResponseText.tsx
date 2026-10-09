import { isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function CodeBlock({ children }: { children?: ReactNode }) {
  if (!isValidElement(children)) return <pre>{children}</pre>

  const code = children as ReactElement<{ children?: ReactNode; className?: string }>
  const language = code.props.className?.match(/language-([\w+-]+)/)?.[1]
  const source = String(code.props.children ?? '').replace(/\n$/, '')

  return <ResponseCodeBlock language={language} source={source}/>
}

function ResponseCodeBlock({ language, source }: { language?: string; source: string }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(source)
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 1600)
    } catch { setCopyStatus('error') }
  }

  return <div className="pg-code-block">
    <div className="pg-code-heading"><span>{language ?? 'Código'}</span><button type="button" onClick={(event) => {
      event.preventDefault()
      void copyCode()
    }} aria-label={copyStatus === 'copied' ? 'Código copiado' : copyStatus === 'error' ? 'No se pudo copiar el código' : 'Copiar código'}>{copyStatus === 'copied' ? 'Copiado' : copyStatus === 'error' ? 'Error al copiar' : 'Copiar'}</button></div>
    <pre><code className={language ? `language-${language}` : undefined}>{source}</code></pre>
  </div>
}

export function ResponseText({ text }: { text: string }) {
  return <div className="pg-response-text">
    <Markdown remarkPlugins={[remarkGfm]} components={{
      pre: CodeBlock,
      table: ({ children }) => <div className="pg-table-scroll" role="region" aria-label="Tabla de la respuesta" tabIndex={0}><table>{children}</table></div>,
      a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel={href?.startsWith('#') ? undefined : 'noreferrer'}>{children}</a>,
    }}>{text}</Markdown>
  </div>
}
