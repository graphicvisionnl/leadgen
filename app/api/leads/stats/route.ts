export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createServerSupabaseClient()

  const [leadsRes, hotRes, followupRes] = await Promise.all([
    supabase.from('leads').select('status'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('hot_lead', true).eq('crm_status', 'not_contacted'),
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .lte('next_followup_at', new Date().toISOString())
      .eq('sequence_stopped', false)
      .not('next_followup_at', 'is', null),
  ])

  const leads = leadsRes.data ?? []

  return NextResponse.json({
    scraped: leads.filter(l => ['scraped', 'no_email'].includes(l.status)).length,
    qualified: leads.filter(l => ['qualified', 'redesigned', 'deployed', 'sent'].includes(l.status)).length,
    deployed: leads.filter(l => ['deployed', 'sent'].includes(l.status)).length,
    sent: leads.filter(l => l.status === 'sent').length,
    hot_leads: hotRes.count ?? 0,
    due_followups: followupRes.count ?? 0,
  })
}
