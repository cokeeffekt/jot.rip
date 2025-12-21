export interface ChecklistItem {
  lineIndex: number
  checked: boolean
}

export interface ImagePlaceholder {
  lineIndex: number
  imageId: string
}

export interface UrlMatch {
  lineIndex: number
  url: string
}

export interface TagMatch {
  lineIndex: number
  tag: string
  priority?: boolean
}

export interface DateMatch {
  lineIndex: number
  date: string
  entryText: string
}

export interface ParsedText {
  checklists: ChecklistItem[]
  images: ImagePlaceholder[]
  urls: UrlMatch[]
  tags: TagMatch[]
  dates: DateMatch[]
}

const urlRegex = /\bhttps?:\/\/[^\s<>"')]+/g
const dateRegex = /@(\d{4}-\d{2}-\d{2})/g
const imageRegex = /!\[image:([^\]]+)\]/g
const checklistRegex = /^\s*-\s\[( |x|X)\]/

export function parseText(text: string): ParsedText {
  const checklists: ChecklistItem[] = []
  const images: ImagePlaceholder[] = []
  const urls: UrlMatch[] = []
  const tags: TagMatch[] = []
  const dates: DateMatch[] = []

  text.split('\n').forEach((line, lineIndex) => {
    imageRegex.lastIndex = 0
    urlRegex.lastIndex = 0
    dateRegex.lastIndex = 0

    const checklistMatch = line.match(checklistRegex)
    if (checklistMatch) {
      const marker = (checklistMatch[1] ?? '').toLowerCase()
      checklists.push({ lineIndex, checked: marker === 'x' })
    }

    let imgMatch: RegExpExecArray | null
    while ((imgMatch = imageRegex.exec(line))) {
      const imageId = imgMatch?.[1]
      if (imageId) images.push({ lineIndex, imageId })
    }

    let urlMatch: RegExpExecArray | null
    while ((urlMatch = urlRegex.exec(line))) {
      const url = urlMatch?.[0]
      if (url) urls.push({ lineIndex, url })
    }

    if (line.startsWith('#!')) {
      const tag = line.slice(2).trim()
      if (tag) tags.push({ lineIndex, tag, priority: true })
    } else if (line.startsWith('#')) {
      const tag = line.slice(1).trim()
      if (tag) tags.push({ lineIndex, tag, priority: false })
    }

    let dMatch: RegExpExecArray | null
    while ((dMatch = dateRegex.exec(line))) {
      if (!dMatch) continue
      const tokenEnd = dMatch.index + dMatch[0].length
      const entryText = line.slice(tokenEnd).trim()
      const date = dMatch[1]
      if (date) dates.push({ lineIndex, date, entryText })
    }
  })

  return { checklists, images, urls, tags, dates }
}
