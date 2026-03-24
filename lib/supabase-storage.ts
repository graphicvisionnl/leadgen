import { createServerSupabaseClient } from './supabase'

export async function uploadScreenshot(
  buffer: Buffer,
  filename: string,
  bucket: 'screenshots' | 'previews' = 'screenshots'
): Promise<string> {
  const supabase = createServerSupabaseClient()

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename)
  return data.publicUrl
}

export async function uploadHtml(
  html: string,
  filename: string
): Promise<string> {
  const supabase = createServerSupabaseClient()

  const buffer = Buffer.from(html, 'utf-8')

  const { error } = await supabase.storage
    .from('previews')
    .upload(filename, buffer, {
      contentType: 'text/html',
      upsert: true,
    })

  if (error) throw new Error(`HTML upload failed: ${error.message}`)

  const { data } = supabase.storage.from('previews').getPublicUrl(filename)
  return data.publicUrl
}

export async function downloadHtml(filename: string): Promise<string> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase.storage
    .from('previews')
    .download(filename)

  if (error || !data) throw new Error(`HTML download failed: ${error?.message}`)

  return await data.text()
}

export function getFilenameFromUrl(url: string): string {
  return url.split('/').pop() ?? url
}
