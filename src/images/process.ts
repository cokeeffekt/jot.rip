export interface ProcessedImage {
  blob: Blob
  mime: string
  width: number
  height: number
  thumbnailDataUrl?: string
}

const MAX_DIMENSION = 1920
const THUMB_SIZE = 240

export async function processImageFile(file: File): Promise<ProcessedImage> {
  const img = await loadImage(file)
  const { canvas, mime, width, height } = await downscale(img, MAX_DIMENSION)
  const blob = await canvasToBlob(canvas, mime)
  const thumbCanvas = await createThumbnail(img)
  const thumbnailDataUrl = thumbCanvas.toDataURL('image/webp', 0.8)

  return { blob, mime, width, height, thumbnailDataUrl }
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function downscale(img: HTMLImageElement, maxDim: number) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(img, 0, 0, width, height)

  const mime = canvas.toDataURL('image/webp').length < canvas.toDataURL('image/jpeg', 0.85).length ? 'image/webp' : 'image/jpeg'
  return { canvas, mime, width, height }
}

async function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Failed to create blob'))
        else resolve(blob)
      },
      mime,
      mime === 'image/jpeg' ? 0.85 : 0.8
    )
  })
}

async function createThumbnail(img: HTMLImageElement) {
  const scale = Math.min(1, THUMB_SIZE / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas
}
