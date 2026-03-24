import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { sendPreviewMail } from '@/lib/mail'

export async function POST(
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

  if (!lead.email) {
    return NextResponse.json({ error: 'Lead heeft geen e-mailadres' }, { status: 400 })
  }

  if (!lead.preview_url) {
    return NextResponse.json({ error: 'Nog geen preview URL — deploy eerst' }, { status: 400 })
  }

  // Haal e-mail handtekening op uit settings
  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((s: { key: string; value: string }) => [s.key, s.value])
  )

  try {
    await sendPreviewMail({
      to: lead.email,
      companyName: lead.company_name!,
      niche: lead.niche!,
      previewUrl: lead.preview_url,
      signature: settings.email_signature,
    })

    // Update status naar 'sent'
    await supabase
      .from('leads')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', params.id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[send-email] Fout:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
