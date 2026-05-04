export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getFakeEmailReason } from '@/lib/email-quality'

export async function GET() {
  const supabase = createServerSupabaseClient()

  const [leadsRes, hotRes, followupRes, repliedRes] = await Promise.all([
    supabase.from('leads').select('status,email,email1_subject,email1_body,email1_sent_at,created_at,updated_at,crm_status,sequence_stopped'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('hot_lead', true).eq('crm_status', 'not_contacted'),
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .lte('next_followup_at', new Date().toISOString())
      .eq('sequence_stopped', false)
      .not('next_followup_at', 'is', null),
    supabase.from('leads').select('id', { count: 'exact', head: true }).not('reply_received_at', 'is', null),
  ])

  const leads = leadsRes.data ?? []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const lastLead = [...leads].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  const lastUpdated = [...leads].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]

  return NextResponse.json({
    scraped: leads.filter(l => ['scraped', 'no_email'].includes(l.status)).length,
    qualified: leads.filter(l => ['qualified', 'redesigned', 'deployed', 'sent'].includes(l.status)).length,
    deployed: leads.filter(l => ['deployed', 'sent'].includes(l.status)).length,
    sent: leads.filter(l => l.status === 'sent').length,
    errors: leads.filter(l => l.status === 'error').length,
    fake_emails: leads.filter(l => l.status !== 'sent' && getFakeEmailReason(l.email)).length,
    email_ready: leads.filter(l =>
      ['qualified', 'redesigned', 'deployed'].includes(l.status) &&
      !!l.email?.trim() &&
      !!l.email1_body?.trim() &&
      !l.email1_sent_at &&
      !['closed', 'rejected'].includes(l.crm_status ?? '') &&
      l.sequence_stopped !== true
    ).length,
    added_today: leads.filter(l => new Date(l.created_at) >= today).length,
    last_lead_at: lastLead?.created_at ?? null,
    last_activity_at: lastUpdated?.updated_at ?? null,
    hot_leads: hotRes.count ?? 0,
    due_followups: followupRes.count ?? 0,
    replied: repliedRes.count ?? 0,
  })
}
