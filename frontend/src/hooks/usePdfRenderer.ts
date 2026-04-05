/**
 * Renders the first page of a PDF file to a data URL using PDF.js.
 * Returns a data URL (not a blob URL) which is compatible with fabric.Image.
 */
import * as pdfjsLib from 'pdfjs-dist'
import { useEffect, useState } from 'react'

// Point the worker at the bundled worker file via Vite's asset handling
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface PdfRenderResult {
  dataUrl: string | null
  width: number
  height: number
  error: string | null
  loading: boolean
}

/**
 * @param file  The PDF File object, or null
 * @param scale Render scale — 2 gives a crisp 2× raster for a typical A3 plan
 */
export function usePdfRenderer(file: File | null, scale = 2): PdfRenderResult {
  const [result, setResult] = useState<PdfRenderResult>({
    dataUrl: null,
    width: 0,
    height: 0,
    error: null,
    loading: false,
  })

  useEffect(() => {
    if (!file) return

    let cancelled = false
    setResult({ dataUrl: null, width: 0, height: 0, error: null, loading: true })

    const run = async () => {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        const page = await pdf.getPage(1)
        const viewport = page.getViewport({ scale })

        const offscreen = document.createElement('canvas')
        offscreen.width = viewport.width
        offscreen.height = viewport.height
        const ctx = offscreen.getContext('2d')
        if (!ctx) throw new Error('Could not get 2D context')

        await page.render({ canvasContext: ctx, viewport }).promise

        if (cancelled) return
        setResult({
          dataUrl: offscreen.toDataURL('image/png'),
          width: viewport.width,
          height: viewport.height,
          error: null,
          loading: false,
        })
      } catch (e) {
        if (cancelled) return
        setResult({ dataUrl: null, width: 0, height: 0, error: String(e), loading: false })
      }
    }

    void run()
    return () => { cancelled = true }
  }, [file, scale])

  return result
}
