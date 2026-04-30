import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

// Vercel cron job — runs daily at 09:00 UTC on weekdays
// Vercel automatically adds the Authorization: Bearer <CRON_SECRET> header
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerSupabaseClient()
  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((s: { key: string; value: string }) => [s.key, s.value])
  )

  // Check auto mode — bail out if manual
  const autoMode = settings.auto_mode ?? 'manual'
  if (autoMode === 'manual') {
    console.log('[Cron] Auto mode is manual — skipping run')
    return NextResponse.json({ skipped: true, reason: 'manual mode' })
  }

  // Parse rotation lists
  let cities: string[] = []
  let niches: string[] = []
  try { cities = JSON.parse(settings.cities_list ?? '[]') } catch {}
  try { niches = JSON.parse(settings.niches_list ?? '[]') } catch {}

  if (cities.length === 0 || niches.length === 0) {
    console.warn('[Cron] No cities or niches configured')
    return NextResponse.json({ error: 'Geen steden of niches geconfigureerd in instellingen' }, { status: 400 })
  }

  // Pick next city and niche using rotation indices
  const cityIdx = parseInt(settings.city_rotation_index ?? '0') % cities.length
  const nicheIdx = parseInt(settings.niche_rotation_index ?? '0') % niches.length

  const city = cities[cityIdx]
  const niche = niches[nicheIdx]

  // Advance rotation indices (city advances every run, niche advances when city wraps)
  const nextCityIdx = (cityIdx + 1) % cities.length
  const nextNicheIdx = nextCityIdx === 0 ? (nicheIdx + 1) % niches.length : nicheIdx

  await supabase.from('settings').upsert([
    { key: 'city_rotation_index', value: String(nextCityIdx) },
    { key: 'niche_rotation_index', value: String(nextNicheIdx) },
  ], { onConflict: 'key' })

  console.log(`[Cron] Running: niche="${niche}" city="${city}" mode="${autoMode}"`)

  const pipelineUrl = process.env.PIPELINE_SERVER_URL
  const pipelineSecret = process.env.PIPELINE_SECRET

  if (!pipelineUrl || !pipelineSecret) {
    return NextResponse.json({ error: 'Pipeline server niet geconfigureerd' }, { status: 500 })
  }

  const res = await fetch(`${pipelineUrl}/run`, {
    method: 'POST',
    headers: { 'x-pipeline-secret': pipelineSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      niche,
      city,
      maxLeads: parseInt(settings.max_leads ?? '80'),
      mode: autoMode === 'auto_send' ? 'send' : 'draft',
    }),
  }).catch(() => null)

  if (!res?.ok) {
    return NextResponse.json({ error: 'Pipeline server fout' }, { status: 502 })
  }

  const data = await res.json()
  console.log('[Cron] Pipeline triggered:', data)

  return NextResponse.json({
    triggered: true,
    niche,
    city,
    mode: autoMode,
    cityIndex: cityIdx,
    nicheIndex: nicheIdx,
    ...data,
  })
}
