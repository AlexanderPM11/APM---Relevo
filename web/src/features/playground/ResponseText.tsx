import { Fragment, type ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part)
}
export function ResponseText({ text }: { text: string }) {
  const sections = text.split(/```/g)
  return <div className="pg-response-text">{sections.map((section, index) => {
    if (index % 2) {
      const newline = section.indexOf('\n')
      const language = newline >= 0 ? section.slice(0, newline).trim() : ''
      const code = newline >= 0 ? section.slice(newline + 1) : section
      return <div className="pg-code-block" key={index}>{language && <span>{language}</span>}<pre><code>{code}</code></pre></div>
    }
    return <Fragment key={index}>{section.split(/\n\s*\n/).filter(Boolean).map((paragraph, part) => {
      if (/^#{1,6}\s/.test(paragraph)) return <h3 key={part}>{inline(paragraph.replace(/^#{1,6}\s/, ''))}</h3>
      const lines = paragraph.split('\n')
      if (lines.every((line) => /^\s*[-*]\s/.test(line))) return <ul key={part}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*[-*]\s/, ''))}</li>)}</ul>
      if (lines.every((line) => /^\s*\d+[.)]\s/.test(line))) return <ol key={part}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*\d+[.)]\s/, ''))}</li>)}</ol>
      return <p key={part}>{inline(paragraph)}</p>
    })}</Fragment>
  })}</div>
}
