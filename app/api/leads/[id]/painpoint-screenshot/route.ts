export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { image, force } = await request.json().catch(() => ({ image: '', force: false }))
  const match = typeof image === 'string'
    ? image.match(/^data:image\/(png|jpeg);base64,(.+)$/)
    : null

  if (!match) {
    const pipelineUrl = process.env.PIPELINE_SERVER_URL
    const pipelineSecret = process.env.PIPELINE_SECRET
    if (!pipelineUrl || !pipelineSecret) {
      return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
    }

    const res = await fetch(`${pipelineUrl}/generate-painpoint-screenshot/${params.id}`, {
      method: 'POST',
      headers: { 'x-pipeline-secret': pipelineSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: force === true }),
    }).catch(() => null)

    if (!res) return NextResponse.json({ error: 'Pipeline fout' }, { status: 502 })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Screenshot genereren mislukt' }, { status: res.status })
    }
    return NextResponse.json(data)
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
