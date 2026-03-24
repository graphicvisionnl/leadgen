import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET() {
  const checks: Record<string, { ok: boolean; message: string }> = {}

  // Check Supabase
  try {
    const supabase = createServerSupabaseClient()
    const { error } = await supabase.from('settings').select('key').limit(1)
    checks.supabase = error
      ? { ok: false, message: error.message }
      : { ok: true, message: 'Verbonden' }
  } catch (err) {
    checks.supabase = { ok: false, message: String(err) }
  }

  // Check env vars present (not their validity)
  const envVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'APIFY_API_TOKEN',
    'VERCEL_API_TOKEN',
    'SMTP_HOST',
    'SMTP_USER',
  ]
  checks.env = {
    ok: envVars.every((k) => !!process.env[k]),
    message: envVars
      .map((k) => `${k}: ${process.env[k] ? '✓' : '✗ MISSING'}`)
      .join(', '),
  }

  const allOk = Object.values(checks).every((c) => c.ok)

  return NextResponse.json(checks, { status: allOk ? 200 : 500 })
}
