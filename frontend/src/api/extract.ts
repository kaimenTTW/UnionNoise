import type { ExtractedParameters } from '../types'
import { apiClient } from './client'

/** POST /api/extract with a file upload (multipart). */
export async function extractFromFile(file: File): Promise<ExtractedParameters> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiClient.post<ExtractedParameters>('/extract', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

/** POST /api/extract-text with raw pasted text. */
export async function extractFromText(text: string): Promise<ExtractedParameters> {
  const res = await apiClient.post<ExtractedParameters>('/extract-text', { text })
  return res.data
}
