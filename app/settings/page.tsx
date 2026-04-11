'use client'

import { useState, useEffect, KeyboardEvent } from 'react'

type AutoMode = 'manual' | 'auto_draft' | 'auto_send'

interface SmtpAccount {
  email: string
  pass: string
}

interface Settings {
  auto_mode: AutoMode
  cities_list: string[]
  niches_list: string[]
  smtp_accounts: SmtpAccount[]
  max_leads: string
}

const DEFAULT_SETTINGS: Settings = {
  auto_mode: 'manual',
  cities_list: [],
  niches_list: [],
  smtp_accounts: [],
  max_leads: '30',
}

const MODE_OPTIONS: { value: AutoMode; label: string; desc: string; color: string }[] = [
  {
    value: 'manual',
    label: 'Handmatig',
    desc: 'Geen automatische scraping. Alles doe je zelf via de pipeline pagina.',
    color: 'border-white/20 text-white',
  },
  {
    value: 'auto_draft',
    label: 'Auto + Concept',
    desc: 'Dagelijkse scraping + kwalificatie + e-mailsequentie gegenereerd. Email 1 staat klaar als concept — jij verstuurt.',
    color: 'border-yellow-500/40 text-yellow-400',
  },
  {
    value: 'auto_send',
    label: 'Auto + Verstuur',
    desc: 'Volledig automatisch: scrapen → kwalificeren → Email 1 direct versturen. Geen tussenkomst nodig.',
    color: 'border-green-500/40 text-green-400',
  },
]

function TagInput({
  label,
  description,
  placeholder,
  tags,
  onChange,
}: {
  label: string
  description: string
  placeholder: string
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const [input, setInput] = useState('')

  function add() {
    const val = input.trim()
    if (val && !tags.includes(val)) onChange([...tags, val])
    setInput('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
    if (e.key === 'Backspace' && !input && tags.length > 0) onChange(tags.slice(0, -1))
  }

  function remove(tag: string) {
    onChange(tags.filter(t => t !== tag))
  }

  return (
    <div className="p-5">
      <label className="block text-sm font-medium mb-1">{label}</label>
      <p className="text-white/40 text-xs mb-3">{description}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map(tag => (
          <span key={tag} className="flex items-center gap-1 bg-white/8 border border-subtle rounded-full px-2.5 py-0.5 text-xs text-white/80">
            {tag}
            <button onClick={() => remove(tag)} className="text-white/30 hover:text-white/70 ml-0.5 leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={placeholder}
          className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 flex-1 max-w-xs"
        />
        <button
          onClick={add}
          className="px-3 py-2 bg-white/8 border border-subtle rounded-lg text-sm text-white/60 hover:text-white transition-colors"
        >
          + Toevoegen
        </button>
      </div>
    </div>
  )
}

function AddAccountRow({ onAdd }: { onAdd: (acc: SmtpAccount) => void }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')

  function add() {
    if (!email.trim() || !pass.trim()) return
    onAdd({ email: email.trim(), pass: pass.trim() })
    setEmail('')
    setPass('')
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="e-mailadres"
        className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 flex-1 min-w-[180px]"
      />
      <input
        type="password"
        value={pass}
        onChange={e => setPass(e.target.value)}
        placeholder="wachtwoord"
        className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 flex-1 min-w-[140px]"
      />
      <button
        onClick={add}
        className="px-3 py-2 bg-white/8 border border-subtle rounded-lg text-sm text-white/60 hover:text-white transition-colors whitespace-nowrap"
      >
        + Toevoegen
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        setSettings({
          auto_mode: (data.auto_mode as AutoMode) ?? 'manual',
          cities_list: parseJsonArray(data.cities_list),
          niches_list: parseJsonArray(data.niches_list),
          smtp_accounts: parseJsonArray(data.smtp_accounts) as unknown as SmtpAccount[],
          max_leads: data.max_leads ?? '30',
        })
      })
  }, [])

  function parseJsonArray(val: string | undefined): string[] {
    if (!val) return []
    try { return JSON.parse(val) } catch { return [] }
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_mode: settings.auto_mode,
          cities_list: JSON.stringify(settings.cities_list),
          niches_list: JSON.stringify(settings.niches_list),
          smtp_accounts: JSON.stringify(settings.smtp_accounts),
          max_leads: settings.max_leads,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Instellingen</h1>
        <p className="text-white/45 text-sm mt-1">Auto-scrape modus, rotatie &amp; e-mail configuratie</p>
      </div>

      {/* Auto scrape mode */}
      <div className="bg-surface rounded-xl border border-subtle overflow-hidden">
        <div className="p-5 border-b border-subtle">
          <h2 className="font-semibold text-sm">Auto-scrape modus</h2>
          <p className="text-white/40 text-xs mt-1">
            De dagelijkse Vercel cron job draait elke ochtend om 09:00 en roteert door de steden en niches hieronder.
          </p>
        </div>
        <div className="divide-y divide-subtle">
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSettings(s => ({ ...s, auto_mode: opt.value }))}
              className={`w-full text-left p-5 flex items-start gap-4 transition-colors hover:bg-white/[0.03] ${settings.auto_mode === opt.value ? 'bg-white/[0.04]' : ''}`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${settings.auto_mode === opt.value ? opt.color.split(' ')[0] : 'border-white/20'}`}>
                {settings.auto_mode === opt.value && <div className={`w-2 h-2 rounded-full ${opt.value === 'auto_draft' ? 'bg-yellow-400' : opt.value === 'auto_send' ? 'bg-green-400' : 'bg-white'}`} />}
              </div>
              <div>
                <p className={`text-sm font-medium ${settings.auto_mode === opt.value ? opt.color.split(' ')[1] : 'text-white/70'}`}>
                  {opt.label}
                </p>
                <p className="text-xs text-white/40 mt-0.5">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Cities + Niches rotation */}
      <div className="bg-surface rounded-xl border border-subtle divide-y divide-subtle">
        <div className="p-5 pb-3">
          <h2 className="font-semibold text-sm">Rotatie</h2>
          <p className="text-white/40 text-xs mt-1">
            Elke cron run pakt de volgende stad + niche uit de lijst. Druk Enter of komma om een item toe te voegen.
          </p>
        </div>

        <TagInput
          label="Steden"
          description="De cron roteert dagelijks door deze steden (bijv. Amsterdam → Rotterdam → Utrecht → …)"
          placeholder="Voeg stad toe…"
          tags={settings.cities_list}
          onChange={cities_list => setSettings(s => ({ ...s, cities_list }))}
        />

        <TagInput
          label="Niches / Beroepen"
          description="De cron roteert door deze niches (bijv. loodgieter → schilder → elektricien → …)"
          placeholder="Voeg niche toe…"
          tags={settings.niches_list}
          onChange={niches_list => setSettings(s => ({ ...s, niches_list }))}
        />

        <div className="p-5">
          <label className="block text-sm font-medium mb-1">Max leads per run</label>
          <p className="text-white/40 text-xs mb-3">Hoeveel bedrijven Apify per cron run scrapet (10–100).</p>
          <input
            type="number"
            min="10"
            max="100"
            value={settings.max_leads}
            onChange={e => setSettings(s => ({ ...s, max_leads: e.target.value }))}
            className="bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 w-24"
          />
        </div>
      </div>

      {/* Sending accounts */}
      <div className="bg-surface rounded-xl border border-subtle overflow-hidden">
        <div className="p-5 border-b border-subtle">
          <h2 className="font-semibold text-sm">Verzendaccounts</h2>
          <p className="text-white/40 text-xs mt-1">
            Per verstuurde mail wordt het volgende account gebruikt (rotatie). Naam wordt afgeleid van het e-mailadres.
          </p>
        </div>
        <div className="divide-y divide-subtle">
          {settings.smtp_accounts.map((acc, i) => (
            <div key={i} className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/8 border border-subtle flex items-center justify-center text-xs font-medium text-white/60">
                {acc.email.split('@')[0].charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/80 truncate">{acc.email}</p>
                <p className="text-xs text-white/30">{'•'.repeat(Math.min(acc.pass.length, 12))}</p>
              </div>
              <button
                onClick={() => setSettings(s => ({ ...s, smtp_accounts: s.smtp_accounts.filter((_, j) => j !== i) }))}
                className="text-white/25 hover:text-red-400 transition-colors text-sm px-2"
              >
                ×
              </button>
            </div>
          ))}
          <div className="p-4">
            <AddAccountRow onAdd={acc => setSettings(s => ({ ...s, smtp_accounts: [...s.smtp_accounts, acc] }))} />
          </div>
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
        {saved && <span className="text-green-400 text-sm">✓ Opgeslagen</span>}
      </div>

      {/* API keys info */}
      <div className="bg-surface rounded-xl border border-subtle p-5 space-y-3">
        <h2 className="font-semibold text-sm">API sleutels &amp; credentials</h2>
        <p className="text-white/45 text-sm">
          API keys worden niet hier opgeslagen — gebruik Vercel &amp; Hetzner Environment Variables.
        </p>
        <div className="space-y-1.5 text-xs text-white/40 font-mono">
          {[
            'ANTHROPIC_API_KEY',
            'APIFY_API_TOKEN',
            'NEXT_PUBLIC_SUPABASE_URL',
            'NEXT_PUBLIC_SUPABASE_ANON_KEY',
            'SUPABASE_SERVICE_ROLE_KEY',
            'VERCEL_API_TOKEN',
            'SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS',
            'IMAP_HOST / IMAP_PORT',
            'CRON_SECRET',
            'PIPELINE_SERVER_URL / PIPELINE_SECRET',
          ].map(key => (
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
