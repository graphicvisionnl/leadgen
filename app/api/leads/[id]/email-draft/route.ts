import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { buildEmailDraft } from '@/lib/mail'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!lead) {
    return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
  }

  if (!lead.email || !lead.preview_url) {
    return NextResponse.json({ error: 'E-mail of preview URL ontbreekt' }, { status: 400 })
  }

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((s: { key: string; value: string }) => [s.key, s.value])
  )

  const draft = buildEmailDraft({
    to: lead.email,
    companyName: lead.company_name ?? lead.email,
    previewUrl: lead.preview_url,
    signature: settings.email_signature,
  })

  return NextResponse.json(draft)
}
