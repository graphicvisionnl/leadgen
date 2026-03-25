import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function DELETE() {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('leads')
    .delete({ count: 'exact' })
    .eq('status', 'disqualified')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, count })
}
