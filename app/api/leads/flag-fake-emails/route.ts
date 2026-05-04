import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getFakeEmailReason } from '@/lib/email-quality'

export async function POST() {
  const supabase = createServerSupabaseClient()

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id,email,status,qualify_reason')
    .not('email', 'is', null)
    .neq('status', 'sent')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const flagged = (leads ?? [])
    .map((lead) => ({ ...lead, reason: getFakeEmailReason(lead.email) }))
    .filter((lead) => lead.reason)

  if (!flagged.length) {
    return NextResponse.json({ success: true, count: 0 })
  }

  const updates = await Promise.all(flagged.map((lead) => {
    const currentReason = lead.qualify_reason ? `${lead.qualify_reason}\n` : ''
    return supabase
      .from('leads')
      .update({
        status: 'error',
        qualify_reason: `${currentReason}Fake e-mail gedetecteerd: ${lead.reason}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
      .select('id')
      .single()
  }))

  const failed = updates.filter((res) => res.error)
  if (failed.length) {
    return NextResponse.json({ error: failed[0].error?.message ?? 'Markeren mislukt' }, { status: 500 })
  }

  return NextResponse.json({ success: true, count: flagged.length })
}
