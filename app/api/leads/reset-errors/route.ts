import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function POST() {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('leads')
    .update({ status: 'scraped', qualify_reason: null })
    .eq('status', 'error')
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ count: data?.length ?? 0 })
}
