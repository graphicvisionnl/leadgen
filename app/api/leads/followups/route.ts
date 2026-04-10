export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .lte('next_followup_at', new Date().toISOString())
    .eq('sequence_stopped', false)
    .lt('email_sequence_index', 4)
    .not('next_followup_at', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ leads: data ?? [] })
}
