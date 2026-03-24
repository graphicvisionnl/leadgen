import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('leads')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
