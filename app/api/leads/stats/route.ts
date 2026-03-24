import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createServerSupabaseClient()

  // Count leads by status created today
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('leads')
    .select('status')
    .gte('created_at', today.toISOString())

  if (error) {
    return NextResponse.json({ scraped: 0, qualified: 0, deployed: 0, sent: 0 })
  }

  const leads = data ?? []

  return NextResponse.json({
    scraped: leads.length,
    qualified: leads.filter((l) =>
      ['qualified', 'redesigned', 'deployed', 'sent'].includes(l.status)
    ).length,
    deployed: leads.filter((l) => ['deployed', 'sent'].includes(l.status)).length,
    sent: leads.filter((l) => l.status === 'sent').length,
  })
}
