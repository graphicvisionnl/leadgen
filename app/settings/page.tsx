'use client'

import { useState, useEffect } from 'react'

interface Settings {
  default_niche: string
  default_city: string
  max_leads: string
  email_signature: string
}

const DEFAULT_SETTINGS: Settings = {
  default_niche: '',
  default_city: '',
  max_leads: '30',
  email_signature: 'Met vriendelijke groet,\nEzra\nGraphic Vision\ngraphicvision.nl',
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => setSettings({ ...DEFAULT_SETTINGS, ...data }))
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  function update(key: keyof Settings, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Instellingen</h1>
        <p className="text-white/45 text-sm mt-1">Configureer de dagelijkse pipeline</p>
      </div>

      <div className="bg-surface rounded-xl border border-subtle divide-y divide-subtle">
        {/* Default niche */}
        <div className="p-5">
          <label className="block text-sm font-medium mb-1">Standaard niche</label>
          <p className="text-white/40 text-xs mb-3">
            Wordt gebruikt door de dagelijkse cron job als er geen niche is opgegeven.
          </p>
          <input
            type="text"
            value={settings.default_niche}
            onChange={(e) => update('default_niche', e.target.value)}
            placeholder="bijv. loodgieter"
            className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-full max-w-sm"
          />
        </div>

        {/* Default city */}
        <div className="p-5">
          <label className="block text-sm font-medium mb-1">Standaard stad</label>
          <p className="text-white/40 text-xs mb-3">
            De stad die gebruikt wordt bij de dagelijkse run.
          </p>
          <input
            type="text"
            value={settings.default_city}
            onChange={(e) => update('default_city', e.target.value)}
            placeholder="bijv. Amsterdam"
            className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-full max-w-sm"
          />
        </div>

        {/* Max leads */}
        <div className="p-5">
          <label className="block text-sm font-medium mb-1">Max leads per run</label>
          <p className="text-white/40 text-xs mb-3">
            Hoeveel bedrijven Apify per run scrapet (10–100).
          </p>
          <input
            type="number"
            min="10"
            max="100"
            value={settings.max_leads}
            onChange={(e) => update('max_leads', e.target.value)}
            className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 w-24"
          />
        </div>

        {/* Email signature */}
        <div className="p-5">
          <label className="block text-sm font-medium mb-1">E-mail handtekening</label>
          <p className="text-white/40 text-xs mb-3">
            Wordt onderaan elke Gmail draft geplaatst.
          </p>
          <textarea
            value={settings.email_signature}
            onChange={(e) => update('email_signature', e.target.value)}
            rows={4}
            className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 w-full resize-none"
          />
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
        {saved && (
          <span className="text-green-400 text-sm">✓ Opgeslagen</span>
        )}
      </div>

      {/* Info section */}
      <div className="bg-surface rounded-xl border border-subtle p-5 space-y-3">
        <h2 className="font-semibold text-sm">API sleutels &amp; credentials</h2>
        <p className="text-white/45 text-sm">
          API keys worden niet hier opgeslagen — gebruik Vercel Environment Variables.
        </p>
        <div className="space-y-1.5 text-xs text-white/40 font-mono">
          {[
            'ANTHROPIC_API_KEY',
            'APIFY_API_TOKEN',
            'NEXT_PUBLIC_SUPABASE_URL',
            'NEXT_PUBLIC_SUPABASE_ANON_KEY',
            'SUPABASE_SERVICE_ROLE_KEY',
            'VERCEL_API_TOKEN',
            'SMTP_HOST',
            'SMTP_PORT',
            'SMTP_USER',
            'SMTP_PASS',
            'CRON_SECRET',
          ].map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-white/20">•</span>
              <span>{key}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
