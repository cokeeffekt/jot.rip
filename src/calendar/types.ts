export interface CalendarEntry {
  date: string
  tokenDate: string
  noteId: string
  noteTitle: string
  firstTabName?: string
  noteColor?: string | null
  tabId: string
  occurrenceIndex: number
  textAfterToken: string
  lineSnippet: string
  lineIndex: number
}
