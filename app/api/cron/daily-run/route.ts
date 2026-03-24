import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

// Vercel cron job — runs daily at 09:00 UTC on weekdays
// Vercel automatically adds the Authorization: Bearer <CRON_SECRET> header
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Load default niche/city/maxLeads from settings
  const supabase = createServerSupabaseClient()
  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((s: { key: string; value: string }) => [s.key, s.value])
  )

  const niche = settings.default_niche
  const city = settings.default_city

  if (!niche || !city) {
    console.warn('[Cron] No default_niche or default_city configured in settings')
    return NextResponse.json(
      { error: 'Geen standaard niche/stad geconfigureerd in instellingen' },
      { status: 400 }
    )
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!

  const res = await fetch(`${baseUrl}/api/pipeline/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      niche,
      city,
      maxLeads: parseInt(settings.max_leads ?? '30'),
    }),
  })

  const data = await res.json()
  console.log('[Cron] Pipeline triggered:', data)

  return NextResponse.json({ triggered: true, ...data })
}
