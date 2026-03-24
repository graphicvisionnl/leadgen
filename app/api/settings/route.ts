import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.from('settings').select('*')

  if (error) {
    return NextResponse.json({})
  }

  const settings = Object.fromEntries(
    (data ?? []).map(({ key, value }: { key: string; value: string }) => [key, value])
  )

  return NextResponse.json(settings)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const supabase = createServerSupabaseClient()

  const entries = Object.entries(body).map(([key, value]) => ({
    key,
    value: String(value),
  }))

  const { error } = await supabase
    .from('settings')
    .upsert(entries, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
