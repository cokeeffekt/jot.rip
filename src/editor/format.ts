export interface SelectionResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

const wrap = (text: string, start: number, end: number, wrapper: string): SelectionResult => {
  const before = text.slice(0, start)
  const middle = text.slice(start, end)
  const after = text.slice(end)
  const wrapped = `${wrapper}${middle || ''}${wrapper}`
  const cursor = start + wrapped.length
  return {
    text: before + wrapped + after,
    selectionStart: cursor,
    selectionEnd: cursor,
  }
}

export const boldSelection = (text: string, start: number, end: number) => wrap(text, start, end, '**')
export const italicSelection = (text: string, start: number, end: number) => wrap(text, start, end, '*')
export const strikeSelection = (text: string, start: number, end: number) => wrap(text, start, end, '~~')

export const toggleHeader = (text: string, cursor: number): SelectionResult => {
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1
  const lineEnd = text.indexOf('\n', cursor)
  const effectiveEnd = lineEnd === -1 ? text.length : lineEnd
  const line = text.slice(lineStart, effectiveEnd)

  const hasHeader = line.startsWith('# ')
  const newLine = hasHeader ? line.replace(/^#\s+/, '') : `# ${line}`
  const delta = newLine.length - line.length

  const newText = text.slice(0, lineStart) + newLine + text.slice(effectiveEnd)
  const newCursor = cursor + delta
  return { text: newText, selectionStart: newCursor, selectionEnd: newCursor }
}

export const insertChecklist = (text: string, cursor: number): SelectionResult => {
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1
  const insert = '- [ ] '
  const newText = text.slice(0, lineStart) + insert + text.slice(lineStart)
  const newCursor = cursor + insert.length
  return { text: newText, selectionStart: newCursor, selectionEnd: newCursor }
}
