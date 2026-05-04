export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { image } = await request.json().catch(() => ({ image: '' }))
  const match = typeof image === 'string'
    ? image.match(/^data:image\/(png|jpeg);base64,(.+)$/)
    : null

  if (!match) {
    return NextResponse.json({ error: 'Ongeldige afbeelding' }, { status: 400 })
  }

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Afbeelding is te groot' }, { status: 413 })
  }

  const supabase = createServerSupabaseClient()
  const filename = `${params.id}-painpoint-${Date.now()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('screenshots')
    .upload(filename, buffer, {
      contentType: `image/${match[1]}`,
      upsert: true,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const url = supabase.storage.from('screenshots').getPublicUrl(filename).data.publicUrl
  const { error: updateError } = await supabase
    .from('leads')
    .update({
      painpoint_screenshot_url: url,
      email1_variant_type: 'painpoint_screenshot',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ url })
}
